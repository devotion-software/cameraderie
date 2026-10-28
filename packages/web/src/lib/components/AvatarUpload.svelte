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
    onclick={() => fileInput?.click()}
    disabled={uploading}
    aria-label="Change profile picture"
  >
    <Avatar {name} src={avatarUrl} size={72} />
    <span class="overlay">{uploading ? '…' : 'Change'}</span>
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
  .overlay {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    background: rgb(0 0 0 / 0.45);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .picture:hover .overlay,
  .picture:focus-visible .overlay {
    opacity: 1;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
</style>
