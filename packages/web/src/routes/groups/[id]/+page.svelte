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
      const task: UploadTask = { name: file.name, fraction: 0 };
      uploads = [...uploads, task];
      try {
        await uploadFile(groupId, file, (f) => {
          task.fraction = f;
          uploads = [...uploads];
        });
      } catch (err) {
        task.error = err instanceof Error ? err.message : 'Upload failed';
        uploads = [...uploads];
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
</script>

{#if group}
  <div class="head">
    <div>
      <a href="/groups" class="muted back">← Groups</a>
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
  .back {
    font-size: 13px;
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
    background: var(--accent);
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
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: block;
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
    background: rgba(0, 0, 0, 0.6);
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
