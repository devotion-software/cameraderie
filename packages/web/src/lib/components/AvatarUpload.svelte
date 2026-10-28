<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { api } from '$lib/api';
  import { uploadAvatar } from '$lib/avatar';
  import Avatar from './Avatar.svelte';

  interface Props {
    name: string;
    avatarUrl: string | null;
    onUpdated?: (avatarUrl: string | null) => void;
  }
  const { name, avatarUrl, onUpdated }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);
  let removing = $state(false);
  let error = $state('');
  let lightboxOpen = $state(false);

  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    uploading = true;
    error = '';
    try {
      const url = await uploadAvatar(file);
      onUpdated?.(url);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to upload image';
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = '';
    }
  }

  async function remove() {
    removing = true;
    error = '';
    try {
      await api.del('/me/avatar');
      onUpdated?.(null);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to remove image';
    } finally {
      removing = false;
    }
  }
</script>

<div class="avatar-upload">
  <button
    class="picture"
    type="button"
    onclick={() => (lightboxOpen = true)}
    disabled={uploading}
    aria-label="View profile picture"
  >
    <Avatar {name} src={avatarUrl} size={72} />
  </button>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/*"
    onchange={onFile}
    hidden
    disabled={uploading}
  />
  <div class="actions">
    <button
      class="btn secondary"
      type="button"
      onclick={() => fileInput?.click()}
      disabled={uploading}
    >
      {uploading ? 'Uploading…' : 'Upload photo'}
    </button>
    {#if avatarUrl}
      <button class="btn ghost" type="button" onclick={remove} disabled={removing || uploading}>
        {removing ? 'Removing…' : 'Remove'}
      </button>
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<svelte:window onkeydown={(e) => lightboxOpen && e.key === 'Escape' && (lightboxOpen = false)} />

{#if lightboxOpen}
  <div
    class="lightbox"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={() => (lightboxOpen = false)}
    transition:fade={{ duration: 150 }}
  >
    <button class="lightbox-close" onclick={() => (lightboxOpen = false)} aria-label="Close">
      ✕
    </button>
    <div
      class="lightbox-content"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 150, start: 0.96 }}
    >
      {#if avatarUrl}
        <img src={avatarUrl} alt={name} />
      {:else}
        <Avatar {name} src={null} size={280} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .avatar-upload {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .picture {
    position: relative;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .picture:disabled {
    cursor: default;
  }
  .actions {
    display: flex;
    gap: 8px;
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
    max-width: min(92vw, 1100px);
    max-height: 90vh;
  }
  .lightbox-content img {
    max-width: min(92vw, 1100px);
    max-height: 90vh;
    border-radius: var(--radius-sm);
    display: block;
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
    transition: background-color var(--dur-fast) ease;
  }
  .lightbox-close:hover {
    background: rgb(255 255 255 / 0.22);
  }
</style>
