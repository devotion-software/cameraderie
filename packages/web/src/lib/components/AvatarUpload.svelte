<script lang="ts">
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

{#if lightboxOpen}
  <div
    class="lightbox"
    role="button"
    tabindex="0"
    onclick={() => (lightboxOpen = false)}
    onkeydown={(e) => e.key === 'Escape' && (lightboxOpen = false)}
  >
    <Avatar {name} src={avatarUrl} size={280} />
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
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.7);
    cursor: pointer;
  }
</style>
