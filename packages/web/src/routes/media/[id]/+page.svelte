<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatBytes, formatDate, formatDuration } from '$lib/format';
  import { downloadOne, QUALITY_OPTIONS, VIDEO_QUALITY_OPTIONS } from '$lib/download';
  import type { Group, MediaItem } from '$lib/types';
  import type { DownloadQuality } from '@cameraderie/shared';
  import Avatar from '$lib/components/Avatar.svelte';

  const session = useSession();
  const mediaId = $derived(page.params.id);

  let item = $state<MediaItem | null>(null);
  let group = $state<Group | null>(null);
  let error = $state('');
  let loading = $state(true);
  let downloading = $state(false);
  let showDownloadMenu = $state(false);
  let downloadQuality = $state<DownloadQuality>('original');
  const qualityOptions = $derived(item?.kind === 'video' ? VIDEO_QUALITY_OPTIONS : QUALITY_OPTIONS);

  // The preview/thumbnail URL can take a moment to actually download even once
  // the derivative is marked 'ready' — track that separately so we can hold a
  // spinner (and the aspect-ratio-reserved space below) until pixels arrive.
  let mediaLoaded = $state(false);
  // Matches the img/video's own `max-width: 100%; max-height: 70vh` sizing, so
  // the reserved box is the same size the media will actually render at.
  const stageRatio = $derived(
    item?.width && item?.height ? item.width / item.height : null,
  );
  const stageWidth = $derived(stageRatio ? `min(100%, calc(70vh * ${stageRatio}))` : undefined);

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
    mediaLoaded = false;
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
    showDownloadMenu = false;
    downloading = true;
    try {
      await downloadOne(item.id, item.filename, downloadQuality);
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
    !!item && (item.uploaderId === $session.data?.user?.id || group?.myRole === 'owner'),
  );

  let reported = $state(false);
  async function report() {
    if (!item) return;
    const reason = prompt('Why are you reporting this? (sent to a moderator)');
    if (!reason || !reason.trim()) return;
    try {
      await api.post(`/media/${item.id}/report`, { reason: reason.trim() });
      reported = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not submit report';
    }
  }
</script>

<svelte:window
  onclick={() => (showDownloadMenu = false)}
  onkeydown={(e) => e.key === 'Escape' && (showDownloadMenu = false)}
/>

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if item}
  <a href="/groups/{item.groupId}" class="back"><span class="arrow">←</span> Back to group</a>

  <div
    class="stage card"
    class:fit={item.kind !== 'video'}
    style:width={item.kind !== 'video' ? stageWidth : undefined}
    style:aspect-ratio={item.kind !== 'video' && stageRatio ? stageRatio : undefined}
  >
    {#if item.state === 'ready' && item.previewUrl}
      {#if !mediaLoaded}
        <div class="stage-loader"><span class="spinner"></span></div>
      {/if}
      {#if item.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={item.previewUrl}
          controls
          playsinline
          class:hidden={!mediaLoaded}
          onloadeddata={() => (mediaLoaded = true)}
        ></video>
      {:else}
        <img
          src={item.previewUrl}
          alt={item.filename}
          class:hidden={!mediaLoaded}
          onload={() => (mediaLoaded = true)}
        />
      {/if}
    {:else if item.state === 'failed'}
      <div class="placeholder">Preview could not be generated. The original is still safe.</div>
    {:else if item.thumbnailUrl}
      <img src={item.thumbnailUrl} alt={item.filename} class="blurry" />
    {:else}
      <div class="placeholder">Processing preview…</div>
    {/if}
  </div>

  {#if item.uploaderName}
    <div class="uploader">
      <Avatar name={item.uploaderName} src={item.uploaderAvatarUrl} size={24} />
      <span class="muted">Uploaded by {item.uploaderName}</span>
    </div>
  {/if}

  <div class="bar">
    <button class="btn secondary" onclick={toggleFavourite}>
      {item.favourited ? '♥' : '♡'}
      {item.favouriteCount}
    </button>
    <div class="download-wrap">
      <button
        class="btn"
        onclick={(e) => {
          e.stopPropagation();
          showDownloadMenu = true;
        }}
        disabled={downloading}
      >
        {downloading ? 'Preparing…' : 'Download'}
      </button>
      {#if showDownloadMenu}
        <div class="download-menu" onclick={(e) => e.stopPropagation()}>
          <label class="quality-row">
            <span class="muted">Quality</span>
            <select class="input" bind:value={downloadQuality}>
              {#each qualityOptions as q (q.value)}
                <option value={q.value}>{q.label}</option>
              {/each}
            </select>
          </label>
          <button class="context-item" onclick={download}>Download</button>
        </div>
      {/if}
    </div>
    <span class="spacer"></span>
    {#if reported}
      <span class="muted">Reported ✓</span>
    {:else}
      <button class="btn ghost" onclick={report}>Report</button>
    {/if}
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
  .stage {
    position: relative;
    padding: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    min-height: 240px;
    border-radius: var(--radius-lg);
  }
  /* Photos sit directly on the glass card background and hug their own
     size instead of filling a fixed-height letterboxed stage. */
  .stage.fit {
    background: none;
    min-height: 0;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
  }
  .stage img,
  .stage video {
    max-width: 100%;
    max-height: 70vh;
    display: block;
  }
  .stage.fit img {
    border-radius: calc(var(--radius-lg) - 1px);
  }
  .stage img.blurry {
    filter: blur(8px);
    opacity: 0.7;
  }
  .stage img.hidden,
  .stage video.hidden {
    display: none;
  }
  .stage-loader {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .placeholder {
    color: var(--text-dim);
    padding: 60px 20px;
    text-align: center;
  }
  .uploader {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 13px;
  }
  .bar {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 16px 0;
  }
  .download-wrap {
    position: relative;
  }
  .download-menu {
    position: absolute;
    left: 0;
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
  .context-item:hover {
    background: var(--surface-2);
  }
  .meta dl {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    margin: 0;
  }
  .meta dt {
    color: var(--text-dim);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .meta dd {
    margin: 0;
  }
</style>
