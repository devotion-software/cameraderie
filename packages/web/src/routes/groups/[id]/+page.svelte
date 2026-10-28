<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { uploadFile } from '$lib/upload';
  import { formatBytes, formatDuration } from '$lib/format';
  import { downloadOne, requestZip, QUALITY_OPTIONS } from '$lib/download';
  import type { Group, MediaItem, Member } from '$lib/types';
  import type { DownloadQuality } from '@cameraderie/shared';
  import Avatar from '$lib/components/Avatar.svelte';

  const session = useSession();
  const groupId = $derived(page.params.id as string);

  let group = $state<Group | null>(null);
  let items = $state<MediaItem[]>([]);
  let members = $state<Member[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');

  let likedOnly = $state(false);
  let sort = $state<'newest' | 'oldest'>('newest');
  const feedQuery = $derived(`liked=${likedOnly}&sort=${sort}`);

  const TILE_FIT_KEY = 'cameraderie:tileFit';
  let tileFit = $state<'square' | 'contain'>('square');
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(TILE_FIT_KEY);
    if (saved === 'contain' || saved === 'square') tileFit = saved;
  }
  function setTileFit(next: 'square' | 'contain') {
    tileFit = next;
    localStorage.setItem(TILE_FIT_KEY, next);
  }

  const MEMBER_AVATAR_LIMIT = 5;
  const overflowing = $derived(members.length > MEMBER_AVATAR_LIMIT);
  const visibleMembers = $derived(
    members.slice(0, overflowing ? MEMBER_AVATAR_LIMIT - 1 : MEMBER_AVATAR_LIMIT),
  );
  const extraMemberCount = $derived(members.length - visibleMembers.length);

  let fileInput = $state<HTMLInputElement>();

  interface UploadTask {
    name: string;
    fraction: number;
    error?: string;
  }
  let uploads = $state<UploadTask[]>([]);

  const statsLine = $derived.by(() => {
    if (!group) return '';
    const parts = [
      `${group.photoCount} photo${group.photoCount === 1 ? '' : 's'}`,
      `${group.videoCount} video${group.videoCount === 1 ? '' : 's'}`,
    ];
    return `${parts.join(', ')} · ${formatBytes(group.totalBytes)}`;
  });

  $effect(() => {
    if ($session.isPending) return;
    if (!$session.data?.user) {
      goto('/login', { replaceState: true });
      return;
    }
    void load();
  });

  // Auto-refresh while anything is still processing.
  $effect(() => {
    const processing = items.some((i) => i.state === 'processing' || i.state === 'uploading');
    if (!processing) return;
    const t = setInterval(() => void refreshFeed(), 4000);
    return () => clearInterval(t);
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const [g, m] = await Promise.all([
        api.get<{ group: Group }>(`/groups/${groupId}`),
        api.get<{ members: Member[] }>(`/groups/${groupId}/members`),
      ]);
      group = g.group;
      members = m.members;
      await refreshFeed();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load group';
    } finally {
      loading = false;
    }
  }

  async function refreshFeed() {
    const res = await api.get<{ media: MediaItem[]; nextCursor: string | null }>(
      `/groups/${groupId}/media?limit=30&${feedQuery}`,
    );
    items = res.media;
    nextCursor = res.nextCursor;
  }

  async function loadMore() {
    if (!nextCursor) return;
    const res = await api.get<{ media: MediaItem[]; nextCursor: string | null }>(
      `/groups/${groupId}/media?limit=30&${feedQuery}&before=${encodeURIComponent(nextCursor)}`,
    );
    items = [...items, ...res.media];
    nextCursor = res.nextCursor;
  }

  async function onFilterChange() {
    loading = true;
    try {
      await refreshFeed();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load media';
    } finally {
      loading = false;
    }
  }

  async function onFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      uploads = [...uploads, { name: file.name, fraction: 0 }];
      // Index into the reactive `uploads` array itself (not the plain object
      // literal above) — $state proxifies the array on assignment, so a
      // closure over the pre-proxy object never triggers a re-render.
      const idx = uploads.length - 1;
      try {
        await uploadFile(groupId, file, (f) => {
          uploads[idx].fraction = f;
        });
      } catch (err) {
        uploads[idx].error = err instanceof Error ? err.message : 'Upload failed';
      }
    }
    await refreshFeed();
    // Clear finished tasks after a moment.
    setTimeout(() => {
      uploads = uploads.filter((u) => u.error);
    }, 1500);
  }

  const amGroupAdmin = $derived(group?.myRole === 'owner' || group?.myRole === 'admin');
  const canManageCover = $derived(amGroupAdmin);

  let settingCover = $state<string | null>(null);
  async function setCover(mediaId: string, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!group) return;
    settingCover = mediaId;
    try {
      const res = await api.put<{ coverMediaId: string; coverThumbnailUrl: string | null }>(
        `/groups/${groupId}/cover`,
        { mediaId },
      );
      group = {
        ...group,
        coverMediaId: res.coverMediaId,
        coverThumbnailUrl: res.coverThumbnailUrl,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to set cover photo';
    } finally {
      settingCover = null;
    }
  }

  let contextMenu = $state<{ x: number; y: number; mediaId: string } | null>(null);
  function onTileContextMenu(mediaId: string, e: MouseEvent) {
    if (!canManageCover) return;
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, mediaId };
  }
  function closeContextMenu() {
    contextMenu = null;
  }
  async function setCoverFromMenu() {
    const mediaId = contextMenu?.mediaId;
    closeContextMenu();
    if (mediaId) await setCover(mediaId);
  }

  let selectMode = $state(false);
  let selected = $state<Set<string>>(new Set());
  let downloading = $state(false);
  let showDownloadMenu = $state(false);
  let showDownloadAllMenu = $state(false);
  let downloadQuality = $state<DownloadQuality>('original');

  function toggleSelectMode() {
    selectMode = !selectMode;
    selected = new Set();
  }

  function toggleSelected(mediaId: string, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const next = new Set(selected);
    if (next.has(mediaId)) next.delete(mediaId);
    else next.add(mediaId);
    selected = next;
  }

  let lightboxIndex = $state<number | null>(null);
  const lightboxItem = $derived(lightboxIndex !== null ? (items[lightboxIndex] ?? null) : null);

  function onTileClick(mediaId: string, index: number, e: MouseEvent) {
    if (selectMode) {
      toggleSelected(mediaId, e);
      return;
    }
    // Let modifier-clicks / middle-click behave normally (open in new tab etc).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    lightboxIndex = index;
  }

  function closeLightbox() {
    lightboxIndex = null;
  }

  function lightboxStep(delta: number) {
    if (lightboxIndex === null) return;
    const next = lightboxIndex + delta;
    if (next >= 0 && next < items.length) lightboxIndex = next;
  }

  function onLightboxKeydown(e: KeyboardEvent) {
    if (lightboxIndex === null) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') lightboxStep(1);
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
  }

  function selectAll() {
    selected = new Set(items.map((m) => m.id));
  }

  function clearSelection() {
    selected = new Set();
  }

  function onDownloadClick(e: MouseEvent) {
    e.stopPropagation();
    showDownloadMenu = true;
  }

  async function downloadIndividually() {
    if (downloading || selected.size === 0) return;
    showDownloadMenu = false;
    downloading = true;
    try {
      for (const id of selected) {
        const m = items.find((i) => i.id === id);
        if (!m) continue;
        try {
          await downloadOne(id, m.filename, downloadQuality);
        } catch (err) {
          error = err instanceof Error ? err.message : `Failed to download ${m.filename}`;
        }
        // Stagger so the browser doesn't block a burst of auto-downloads.
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      downloading = false;
    }
  }

  async function downloadAsZip() {
    if (downloading || selected.size === 0) return;
    showDownloadMenu = false;
    downloading = true;
    try {
      await requestZip([...selected], downloadQuality, `${group?.name ?? 'photos'}.zip`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download zip';
    } finally {
      downloading = false;
    }
  }

  // The zip endpoint caps how many files it will bundle in one request; a
  // "download all" on a big album splits into multiple zips of this size.
  const ZIP_CHUNK_SIZE = 100;

  /** Page through the whole album (not just what's currently loaded). */
  async function fetchAllMedia(): Promise<{ id: string; filename: string }[]> {
    const all: { id: string; filename: string }[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const qs: string = cursor ? `?limit=100&before=${encodeURIComponent(cursor)}` : '?limit=100';
      const res: { media: MediaItem[]; nextCursor: string | null } = await api.get(
        `/groups/${groupId}/media${qs}`,
      );
      all.push(...res.media.map((m: MediaItem) => ({ id: m.id, filename: m.filename })));
      cursor = res.nextCursor;
      hasMore = cursor !== null;
    }
    return all;
  }

  function onDownloadAllClick(e: MouseEvent) {
    e.stopPropagation();
    showDownloadAllMenu = true;
  }

  async function downloadAllIndividually() {
    if (downloading) return;
    showDownloadAllMenu = false;
    downloading = true;
    try {
      const all = await fetchAllMedia();
      for (const m of all) {
        try {
          await downloadOne(m.id, m.filename, downloadQuality);
        } catch (err) {
          error = err instanceof Error ? err.message : `Failed to download ${m.filename}`;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download album';
    } finally {
      downloading = false;
    }
  }

  async function downloadAllAsZip() {
    if (downloading) return;
    showDownloadAllMenu = false;
    downloading = true;
    try {
      const all = await fetchAllMedia();
      const ids = all.map((m) => m.id);
      const chunkCount = Math.ceil(ids.length / ZIP_CHUNK_SIZE);
      for (let i = 0; i < chunkCount; i++) {
        const chunk = ids.slice(i * ZIP_CHUNK_SIZE, (i + 1) * ZIP_CHUNK_SIZE);
        const base = group?.name ?? 'photos';
        const filename = chunkCount > 1 ? `${base} (${i + 1} of ${chunkCount}).zip` : `${base}.zip`;
        await requestZip(chunk, downloadQuality, filename);
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download album';
    } finally {
      downloading = false;
    }
  }
</script>

<svelte:window
  onclick={() => {
    closeContextMenu();
    showDownloadMenu = false;
    showDownloadAllMenu = false;
  }}
  onkeydown={(e) => {
    onLightboxKeydown(e);
    if (e.key !== 'Escape') return;
    closeContextMenu();
    showDownloadMenu = false;
    showDownloadAllMenu = false;
  }}
/>

{#if group}
  <div class="head">
    <div>
      <a href="/groups" class="back"><span class="arrow">←</span> Groups</a>
      <h1>{group.name}</h1>
      {#if group.description}<p class="muted">{group.description}</p>{/if}
      <p class="muted stats">{statsLine}</p>
    </div>
    <span class="spacer"></span>
    <div class="actions">
      <a class="btn secondary member-link" href="/groups/{groupId}/members">
        Members
        {#if visibleMembers.length > 0}
          <span class="member-avatars">
            {#each visibleMembers as m (m.userId)}
              <span class="member-avatar"><Avatar name={m.name} src={m.avatarUrl} size={22} /></span>
            {/each}
            {#if extraMemberCount > 0}
              <span class="member-avatar more">+{extraMemberCount}</span>
            {/if}
          </span>
        {/if}
      </a>
      {#if items.length > 0}
        <button class="btn secondary" onclick={toggleSelectMode}>
          {selectMode ? 'Cancel' : 'Select'}
        </button>
        <div class="download-wrap">
          <button class="btn secondary" onclick={onDownloadAllClick} disabled={downloading}>
            {downloading ? 'Downloading…' : 'Download all'}
          </button>
          {#if showDownloadAllMenu}
            <div class="download-menu" onclick={(e) => e.stopPropagation()}>
              <label class="quality-row">
                <span class="muted">Quality</span>
                <select class="input" bind:value={downloadQuality}>
                  {#each QUALITY_OPTIONS as q (q.value)}
                    <option value={q.value}>{q.label}</option>
                  {/each}
                </select>
              </label>
              <button class="context-item" onclick={downloadAllIndividually}>
                Download individually
              </button>
              <button class="context-item" onclick={downloadAllAsZip}>Download as a zip</button>
            </div>
          {/if}
        </div>
      {/if}
      <button class="btn" onclick={() => fileInput?.click()}>Upload</button>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept="image/*,video/*,.dng,.cr2,.cr3,.nef,.arw,.raf,.rw2,.orf"
        onchange={onFiles}
        hidden
      />
    </div>
  </div>

  {#if uploads.length}
    <div class="card uploads">
      {#each uploads as u (u.name)}
        <div class="up">
          <span class="upname">{u.name}</span>
          {#if u.error}
            <span class="error inline">{u.error}</span>
          {:else}
            <div class="bar"><div class="fill" style="width: {u.fraction * 100}%"></div></div>
            <span class="muted pct">{Math.round(u.fraction * 100)}%</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if error}<p class="error">{error}</p>{/if}

{#if selectMode}
  <div class="card select-bar">
    <span>{selected.size} selected</span>
    <span class="spacer"></span>
    <button class="btn ghost" onclick={selectAll} disabled={selected.size === items.length}>
      Select all
    </button>
    <button class="btn ghost" onclick={clearSelection} disabled={selected.size === 0}>
      Clear
    </button>
    <div class="download-wrap">
      <button class="btn" onclick={onDownloadClick} disabled={selected.size === 0 || downloading}>
        {downloading ? 'Downloading…' : 'Download'}
      </button>
      {#if showDownloadMenu}
        <div class="download-menu" onclick={(e) => e.stopPropagation()}>
          <label class="quality-row">
            <span class="muted">Quality</span>
            <select class="input" bind:value={downloadQuality}>
              {#each QUALITY_OPTIONS as q (q.value)}
                <option value={q.value}>{q.label}</option>
              {/each}
            </select>
          </label>
          <button class="context-item" onclick={downloadIndividually}>
            Download individually ({selected.size} files)
          </button>
          <button class="context-item" onclick={downloadAsZip}> Download as a zip </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if group}
  <div class="filter-bar">
    <button
      class="btn secondary"
      class:active={likedOnly}
      onclick={() => {
        likedOnly = !likedOnly;
        void onFilterChange();
      }}
    >
      ♥ Liked only
    </button>
    <span class="spacer"></span>
    <div class="fit-toggle" role="group" aria-label="Image fit">
      <button
        class="fit-btn"
        class:active={tileFit === 'square'}
        onclick={() => setTileFit('square')}
      >
        Fit to square
      </button>
      <button
        class="fit-btn"
        class:active={tileFit === 'contain'}
        onclick={() => setTileFit('contain')}
      >
        Contain
      </button>
    </div>
    <label class="sort-select">
      <span class="muted">Sort</span>
      <select
        class="input"
        bind:value={sort}
        onchange={() => void onFilterChange()}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </label>
  </div>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if items.length === 0}
  <p class="muted">
    {likedOnly
      ? 'No liked photos or videos yet.'
      : 'No photos or videos yet. Hit Upload to add the first.'}
  </p>
{:else}
  <div class="grid" class:contain-tiles={tileFit === 'contain'}>
    {#each items as m, i (m.id)}
      <a
        class="tile"
        class:selected={selected.has(m.id)}
        href="/media/{m.id}"
        title={m.filename}
        oncontextmenu={(e) => onTileContextMenu(m.id, e)}
        onclick={(e) => onTileClick(m.id, i, e)}
      >
        {#if selectMode}
          <button
            class="overlay check"
            class:checked={selected.has(m.id)}
            onclick={(e) => toggleSelected(m.id, e)}
            title={selected.has(m.id) ? 'Deselect' : 'Select'}
          >
            {selected.has(m.id) ? '✓' : ''}
          </button>
        {/if}
        {#if m.thumbnailUrl}
          <img src={m.thumbnailUrl} alt={m.filename} loading="lazy" />
        {:else if m.state === 'failed'}
          <div class="placeholder failed">⚠︎ failed</div>
        {:else}
          <div class="placeholder"><span class="spinner"></span> processing</div>
        {/if}

        {#if m.kind === 'video'}
          <span class="overlay play">▶ {formatDuration(m.durationMs) ?? ''}</span>
        {:else if m.kind === 'raw'}
          <span class="overlay kind">RAW</span>
        {/if}
        {#if m.favouriteCount > 0}
          <span class="overlay fav">♥ {m.favouriteCount}</span>
        {/if}
        {#if canManageCover && m.thumbnailUrl}
          <button
            class="overlay cover-btn"
            class:is-cover={group?.coverMediaId === m.id}
            onclick={(e) => setCover(m.id, e)}
            disabled={settingCover === m.id}
            title={group?.coverMediaId === m.id ? 'Current cover photo' : 'Set as group cover'}
          >
            {group?.coverMediaId === m.id ? '★' : '☆'}
          </button>
        {/if}
      </a>
    {/each}
  </div>

  {#if nextCursor}
    <div class="more">
      <button class="btn secondary" onclick={loadMore}>Load more</button>
    </div>
  {/if}
{/if}

{#if contextMenu}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    onclick={(e) => e.stopPropagation()}
  >
    {#if group?.coverMediaId === contextMenu.mediaId}
      <span class="context-item disabled">★ Current group cover</span>
    {:else}
      <button class="context-item" onclick={setCoverFromMenu}>★ Set as group cover</button>
    {/if}
  </div>
{/if}

{#if lightboxItem}
  <div class="lightbox" role="dialog" aria-modal="true" tabindex="-1" onclick={closeLightbox}>
    <button class="lightbox-close" onclick={closeLightbox} aria-label="Close">✕</button>
    {#if lightboxIndex !== null && lightboxIndex > 0}
      <button
        class="lightbox-nav prev"
        onclick={(e) => {
          e.stopPropagation();
          lightboxStep(-1);
        }}
        aria-label="Previous"
      >
        ‹
      </button>
    {/if}
    {#if lightboxIndex !== null && lightboxIndex < items.length - 1}
      <button
        class="lightbox-nav next"
        onclick={(e) => {
          e.stopPropagation();
          lightboxStep(1);
        }}
        aria-label="Next"
      >
        ›
      </button>
    {/if}
    <div class="lightbox-content" onclick={(e) => e.stopPropagation()}>
      {#if lightboxItem.kind === 'video'}
        {#if lightboxItem.previewUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={lightboxItem.previewUrl} controls playsinline autoplay></video>
        {:else if lightboxItem.thumbnailUrl}
          <img src={lightboxItem.thumbnailUrl} alt={lightboxItem.filename} class="blurry" />
        {/if}
      {:else if lightboxItem.previewUrl}
        <img src={lightboxItem.previewUrl} alt={lightboxItem.filename} />
      {:else if lightboxItem.thumbnailUrl}
        <img src={lightboxItem.thumbnailUrl} alt={lightboxItem.filename} class="blurry" />
      {:else}
        <div class="placeholder"><span class="spinner"></span> processing</div>
      {/if}
      <a class="lightbox-details" href="/media/{lightboxItem.id}">Open full page ›</a>
    </div>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .head h1 {
    margin: 4px 0 0;
  }
  .stats {
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .member-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .member-avatars {
    display: flex;
  }
  .member-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--surface-1);
    margin-left: -8px;
  }
  .member-avatar:first-child {
    margin-left: 0;
  }
  .member-avatar.more {
    background: var(--surface-2);
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 700;
  }
  .uploads {
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
  }
  .up {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .upname {
    flex: 0 0 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .inline {
    padding: 2px 8px;
    font-size: 12px;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
    transition: width 0.2s ease;
  }
  .pct {
    width: 40px;
    text-align: right;
    font-size: 12px;
  }
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }
  .filter-bar .btn.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .fit-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .fit-btn {
    padding: 6px 12px;
    font-size: 13px;
    border: none;
    background: var(--surface-2);
    color: var(--text-dim);
    cursor: pointer;
  }
  .fit-btn.active {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .sort-select {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .sort-select select {
    padding: 6px 10px;
    font-size: 13px;
  }
  .select-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 16px;
    /* Tiles below each get their own stacking context (backdrop-filter), so
       without this the dropdown menu paints behind them despite z-index. */
    z-index: 10;
  }
  .download-wrap {
    position: relative;
  }
  .download-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 100;
    min-width: 220px;
    padding: 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    box-shadow: 0 16px 36px -14px hsl(var(--shadow-color) / 0.5);
  }
  .quality-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px 10px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .quality-row span {
    font-size: 12px;
  }
  .quality-row select {
    padding: 4px 8px;
    font-size: 13px;
  }
  .tile {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-2);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    display: block;
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    transition:
      transform 0.2s cubic-bezier(0.2, 0.8, 0.3, 1),
      box-shadow 0.2s ease,
      border-color 0.2s ease;
  }
  .tile.selected {
    border-color: var(--accent);
    box-shadow:
      0 0 0 2px var(--accent),
      inset 0 1px 0 var(--glass-highlight);
  }
  .overlay.check {
    left: 8px;
    top: 8px;
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.8);
    cursor: pointer;
    z-index: 1;
  }
  .overlay.check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .tile:hover {
    transform: translateY(-4px) scale(1.02);
    border-color: var(--accent);
    box-shadow:
      0 16px 36px -14px hsl(var(--shadow-color) / 0.5),
      0 0 0 1px var(--accent-soft),
      inset 0 1px 0 var(--glass-highlight);
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .contain-tiles .tile img {
    object-fit: contain;
    background: var(--surface-2);
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .placeholder.failed {
    color: var(--danger);
  }
  .overlay {
    position: absolute;
    font-size: 12px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(10, 10, 26, 0.55);
    backdrop-filter: blur(6px);
    color: white;
  }
  .overlay.play {
    left: 8px;
    bottom: 8px;
  }
  .overlay.kind {
    left: 8px;
    top: 8px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .overlay.fav {
    right: 8px;
    bottom: 8px;
  }
  .cover-btn {
    right: 8px;
    top: 8px;
    border: none;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.55;
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }
  .tile:hover .cover-btn,
  .cover-btn.is-cover {
    opacity: 1;
  }
  .cover-btn:hover:not(:disabled) {
    transform: scale(1.15);
  }
  .cover-btn:disabled {
    cursor: wait;
  }
  .cover-btn.is-cover {
    color: #ffd166;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .more {
    margin-top: 20px;
    text-align: center;
  }
  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 190px;
    padding: 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    box-shadow: 0 16px 36px -14px hsl(var(--shadow-color) / 0.5);
  }
  .context-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    background: none;
    border-radius: calc(var(--radius-sm) - 4px);
    font-size: 13px;
    cursor: pointer;
    color: var(--text);
  }
  .context-item:not(.disabled):hover {
    background: var(--surface-2);
  }
  .context-item.disabled {
    color: var(--text-dim);
    cursor: default;
  }
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.85);
  }
  .lightbox-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: min(92vw, 1100px);
    max-height: 90vh;
  }
  .lightbox-content img,
  .lightbox-content video {
    max-width: min(92vw, 1100px);
    max-height: 80vh;
    border-radius: var(--radius-sm);
    display: block;
  }
  .lightbox-content img.blurry {
    filter: blur(8px);
    opacity: 0.7;
  }
  .lightbox-details {
    color: rgba(255, 255, 255, 0.85);
    font-size: 13px;
  }
  .lightbox-close {
    position: absolute;
    top: 16px;
    right: 20px;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font-size: 16px;
    cursor: pointer;
  }
  .lightbox-close:hover {
    background: rgb(255 255 255 / 0.22);
  }
  .lightbox-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
  }
  .lightbox-nav:hover {
    background: rgb(255 255 255 / 0.22);
  }
  .lightbox-nav.prev {
    left: 20px;
  }
  .lightbox-nav.next {
    right: 20px;
  }
</style>
