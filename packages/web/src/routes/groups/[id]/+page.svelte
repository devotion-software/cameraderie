<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { uploadFile } from '$lib/upload';
  import { formatDuration } from '$lib/format';
  import { downloadOne, requestZip, QUALITY_OPTIONS } from '$lib/download';
  import type { Group, MediaItem } from '$lib/types';
  import type { DownloadQuality } from '@cameraderie/shared';

  const session = useSession();
  const groupId = $derived(page.params.id as string);

  let group = $state<Group | null>(null);
  let items = $state<MediaItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');

  let inviteUrl = $state('');
  let showInvite = $state(false);
  let inviteEmail = $state('');
  let invitingBusy = $state(false);
  let fileInput = $state<HTMLInputElement>();

  interface UploadTask {
    name: string;
    fraction: number;
    error?: string;
  }
  let uploads = $state<UploadTask[]>([]);

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
      const [g] = await Promise.all([api.get<{ group: Group }>(`/groups/${groupId}`)]);
      group = g.group;
      await refreshFeed();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load group';
    } finally {
      loading = false;
    }
  }

  async function refreshFeed() {
    const res = await api.get<{ media: MediaItem[]; nextCursor: string | null }>(
      `/groups/${groupId}/media?limit=30`,
    );
    items = res.media;
    nextCursor = res.nextCursor;
  }

  async function loadMore() {
    if (!nextCursor) return;
    const res = await api.get<{ media: MediaItem[]; nextCursor: string | null }>(
      `/groups/${groupId}/media?limit=30&before=${encodeURIComponent(nextCursor)}`,
    );
    items = [...items, ...res.media];
    nextCursor = res.nextCursor;
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

  async function createInvite(e: SubmitEvent) {
    e.preventDefault();
    invitingBusy = true;
    error = '';
    try {
      const res = await api.post<{ invite: { code: string } }>(`/groups/${groupId}/invites`, {
        email: inviteEmail.trim() || undefined,
      });
      inviteUrl = `${location.origin}/invite/${res.invite.code}`;
      inviteEmail = '';
      showInvite = false;
      await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create invite';
    } finally {
      invitingBusy = false;
    }
  }

  const amGroupAdmin = $derived(group?.myRole === 'owner' || group?.myRole === 'admin');
  const canInvite = $derived.by(() => {
    const u = $session.data?.user as { role?: string; canInviteMembers?: boolean } | undefined;
    return amGroupAdmin && !!u && (u.role === 'admin' || u.canInviteMembers === true);
  });
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

  function onTileClick(mediaId: string, e: MouseEvent) {
    if (!selectMode) return;
    toggleSelected(mediaId, e);
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
    </div>
    <span class="spacer"></span>
    <div class="actions">
      <a class="btn secondary" href="/groups/{groupId}/members">Members</a>
      {#if canInvite && !showInvite}
        <button class="btn secondary" onclick={() => (showInvite = true)}>Invite</button>
      {/if}
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

  {#if showInvite}
    <form class="card invite-form" onsubmit={createInvite}>
      <input
        class="input"
        type="email"
        placeholder="Email to invite (optional — leave blank for a shareable link)"
        bind:value={inviteEmail}
      />
      <button class="btn" type="submit" disabled={invitingBusy}>
        {invitingBusy ? 'Creating…' : 'Create invite'}
      </button>
      <button
        class="btn ghost"
        type="button"
        onclick={() => (showInvite = false)}
        disabled={invitingBusy}
      >
        Cancel
      </button>
    </form>
  {/if}

  {#if inviteUrl}
    <div class="card invite">
      <span class="muted">Invite link (copied):</span>
      <code>{inviteUrl}</code>
    </div>
  {/if}

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

{#if loading}
  <p class="muted">Loading…</p>
{:else if items.length === 0}
  <p class="muted">No photos or videos yet. Hit Upload to add the first.</p>
{:else}
  <div class="grid">
    {#each items as m (m.id)}
      <a
        class="tile"
        class:selected={selected.has(m.id)}
        href="/media/{m.id}"
        title={m.filename}
        oncontextmenu={(e) => onTileContextMenu(m.id, e)}
        onclick={(e) => onTileClick(m.id, e)}
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
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .invite {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 16px;
    padding: 12px 16px;
  }
  .invite-form {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
    padding: 14px 16px;
  }
  .invite-form .input {
    flex: 1;
  }
  .invite code {
    color: var(--accent);
    word-break: break-all;
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
</style>
