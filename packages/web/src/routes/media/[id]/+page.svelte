<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatBytes, formatDate, formatDuration } from '$lib/format';
  import type { Group, MediaItem } from '$lib/types';

  const session = useSession();
  const mediaId = $derived(page.params.id);

  let item = $state<MediaItem | null>(null);
  let group = $state<Group | null>(null);
  let error = $state('');
  let loading = $state(true);
  let downloading = $state(false);

  $effect(() => {
    if ($session.isPending) return;
    if (!$session.data?.user) {
      goto('/login', { replaceState: true });
      return;
    }
    void load();
  });

  async function load() {
    loading = true;
    try {
      const res = await api.get<{ media: MediaItem }>(`/media/${mediaId}`);
      item = res.media;
      const g = await api.get<{ group: Group }>(`/groups/${item.groupId}`);
      group = g.group;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  async function toggleFavourite() {
    if (!item) return;
    const next = !item.favourited;
    item.favourited = next;
    item.favouriteCount += next ? 1 : -1;
    try {
      if (next) await api.put(`/media/${item.id}/favourite`);
      else await api.del(`/media/${item.id}/favourite`);
    } catch {
      // revert on failure
      item.favourited = !next;
      item.favouriteCount += next ? -1 : 1;
    }
  }

  async function download() {
    if (!item) return;
    downloading = true;
    try {
      const res = await api.get<{ url: string }>(`/media/${item.id}/download`);
      const a = document.createElement('a');
      a.href = res.url;
      a.download = item.filename;
      a.click();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Download failed';
    } finally {
      downloading = false;
    }
  }

  async function remove() {
    if (!item || !confirm('Delete this permanently? This removes the original too.')) return;
    try {
      const gid = item.groupId;
      await api.del(`/media/${item.id}`);
      goto(`/groups/${gid}`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Delete failed';
    }
  }

  const canDelete = $derived(
    !!item &&
      (item.uploaderId === $session.data?.user?.id || group?.myRole === 'owner'),
  );
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if item}
  <a href="/groups/{item.groupId}" class="muted back">← Back to group</a>

  <div class="stage card">
    {#if item.state === 'ready' && item.previewUrl}
      {#if item.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={item.previewUrl} controls playsinline></video>
      {:else}
        <img src={item.previewUrl} alt={item.filename} />
      {/if}
    {:else if item.state === 'failed'}
      <div class="placeholder">Preview could not be generated. The original is still safe.</div>
    {:else if item.thumbnailUrl}
      <img src={item.thumbnailUrl} alt={item.filename} class="blurry" />
    {:else}
      <div class="placeholder">Processing preview…</div>
    {/if}
  </div>

  <div class="bar">
    <button class="btn secondary" onclick={toggleFavourite}>
      {item.favourited ? '♥' : '♡'}
      {item.favouriteCount}
    </button>
    <button class="btn" onclick={download} disabled={downloading}>
      {downloading ? 'Preparing…' : 'Download original'}
    </button>
    <span class="spacer"></span>
    {#if canDelete}
      <button class="btn danger" onclick={remove}>Delete</button>
    {/if}
  </div>

  <div class="card meta">
    <dl>
      <dt>File</dt>
      <dd>{item.filename}</dd>
      <dt>Type</dt>
      <dd>{item.kind}{item.mimeType ? ` · ${item.mimeType}` : ''}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(item.sizeBytes)}</dd>
      {#if item.width && item.height}
        <dt>Dimensions</dt>
        <dd>{item.width} × {item.height}</dd>
      {/if}
      {#if item.durationMs}
        <dt>Duration</dt>
        <dd>{formatDuration(item.durationMs)}</dd>
      {/if}
      <dt>Added</dt>
      <dd>{formatDate(item.createdAt)}</dd>
    </dl>
  </div>
{/if}

<style>
  .back {
    font-size: 13px;
    display: inline-block;
    margin-bottom: 12px;
  }
  .stage {
    padding: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    min-height: 240px;
  }
  .stage img,
  .stage video {
    max-width: 100%;
    max-height: 70vh;
    display: block;
  }
  .stage img.blurry {
    filter: blur(8px);
    opacity: 0.7;
  }
  .placeholder {
    color: var(--text-dim);
    padding: 60px 20px;
    text-align: center;
  }
  .bar {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 16px 0;
  }
  .meta dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    margin: 0;
  }
  .meta dt {
    color: var(--text-dim);
  }
  .meta dd {
    margin: 0;
  }
</style>
