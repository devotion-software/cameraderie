<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { uploadFile } from '$lib/upload';
  import { formatDuration } from '$lib/format';
  import type { Group, MediaItem } from '$lib/types';

  const session = useSession();
  const groupId = $derived(page.params.id as string);

  let group = $state<Group | null>(null);
  let items = $state<MediaItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');

  let inviteUrl = $state('');
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

  async function createInvite() {
    try {
      const res = await api.post<{ invite: { code: string } }>(`/groups/${groupId}/invites`, {});
      inviteUrl = `${location.origin}/invite/${res.invite.code}`;
      await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create invite';
    }
  }

  const canInvite = $derived(group?.myRole === 'owner' || group?.myRole === 'admin');
  const canManageCover = $derived(group?.myRole === 'owner' || group?.myRole === 'admin');

  let settingCover = $state<string | null>(null);
  async function setCover(mediaId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!group) return;
    settingCover = mediaId;
    try {
      const res = await api.put<{ coverMediaId: string; coverThumbnailUrl: string | null }>(
        `/groups/${groupId}/cover`,
        { mediaId },
      );
      group = { ...group, coverMediaId: res.coverMediaId, coverThumbnailUrl: res.coverThumbnailUrl };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to set cover photo';
    } finally {
      settingCover = null;
    }
  }
</script>

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
      {#if canInvite}
        <button class="btn secondary" onclick={createInvite}>Invite</button>
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

{#if loading}
  <p class="muted">Loading…</p>
{:else if items.length === 0}
  <p class="muted">No photos or videos yet. Hit Upload to add the first.</p>
{:else}
  <div class="grid">
    {#each items as m (m.id)}
      <a class="tile" href="/media/{m.id}" title={m.filename}>
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
</style>
