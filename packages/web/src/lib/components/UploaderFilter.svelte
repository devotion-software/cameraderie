<script lang="ts">
  import { fade } from 'svelte/transition';
  import Avatar from './Avatar.svelte';

  interface UploaderOption {
    userId: string;
    name: string;
    avatarUrl: string | null;
    mediaCount: number;
  }

  interface Props {
    options: UploaderOption[];
    selected: string[];
    onchange?: (selected: string[]) => void;
  }
  let { options, selected = $bindable(), onchange }: Props = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let listbox = $state<HTMLUListElement | null>(null);

  const triggerLabel = $derived.by(() => {
    if (selected.length === 0) return 'All uploaders';
    if (selected.length === 1) {
      return options.find((o) => o.userId === selected[0])?.name ?? '1 uploader';
    }
    return `${selected.length} uploaders`;
  });

  function toggleMenu() {
    open = !open;
  }

  function closeMenu(refocus = false) {
    open = false;
    if (refocus) trigger?.focus();
  }

  function toggle(userId: string) {
    selected = selected.includes(userId)
      ? selected.filter((id) => id !== userId)
      : [...selected, userId];
    onchange?.(selected);
  }

  function clear() {
    selected = [];
    onchange?.(selected);
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const target = e.target as Node;
    if (trigger?.contains(target) || listbox?.contains(target)) return;
    closeMenu();
  }

  function onListKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    }
  }
</script>

<svelte:window onclick={onDocClick} />

<div class="dropdown">
  <button
    bind:this={trigger}
    type="button"
    class="dropdown-trigger"
    class:active={selected.length > 0}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="Filter by uploader"
    onclick={toggleMenu}
  >
    <span class="dropdown-value">{triggerLabel}</span>
    <svg class="dropdown-caret" width="10" height="6" viewBox="0 0 10 6" fill="none">
      <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  </button>
  {#if open}
    <ul
      bind:this={listbox}
      class="dropdown-list"
      role="listbox"
      aria-multiselectable="true"
      tabindex="-1"
      aria-label="Filter by uploader"
      onkeydown={onListKeydown}
      transition:fade={{ duration: 120 }}
    >
      {#if selected.length > 0}
        <li class="dropdown-option clear" onclick={clear}>Clear filter</li>
      {/if}
      {#each options as option (option.userId)}
        <li
          role="option"
          aria-selected={selected.includes(option.userId)}
          class="dropdown-option uploader-option"
          class:selected={selected.includes(option.userId)}
          onclick={() => toggle(option.userId)}
        >
          <input
            type="checkbox"
            checked={selected.includes(option.userId)}
            tabindex="-1"
            onclick={(e) => e.preventDefault()}
          />
          <Avatar name={option.name} src={option.avatarUrl} size={22} />
          <span class="uploader-name">{option.name}</span>
          <span class="muted uploader-count">{option.mediaCount}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-block;
  }
  .dropdown-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 150px;
    background: var(--surface-2);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }
  .dropdown-trigger:hover {
    border-color: var(--accent);
  }
  .dropdown-trigger.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .dropdown-trigger:focus-visible,
  .dropdown-trigger[aria-expanded='true'] {
    border-color: var(--accent);
    background: var(--surface-strong);
    box-shadow: 0 0 0 4px var(--accent-soft);
    outline: none;
  }
  .dropdown-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dropdown-caret {
    flex: 0 0 auto;
    color: var(--text-dim);
    transition: transform 0.15s ease;
  }
  .dropdown-trigger[aria-expanded='true'] .dropdown-caret {
    transform: rotate(180deg);
  }
  .dropdown-list {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 100;
    min-width: 230px;
    max-height: 320px;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
    border-radius: var(--radius-sm);
    background: var(--surface-strong);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    box-shadow: 0 16px 36px -14px hsl(var(--shadow-color) / 0.5);
    outline: none;
  }
  .dropdown-option {
    padding: 8px 10px;
    border-radius: calc(var(--radius-sm) - 4px);
    font-size: 13px;
    cursor: pointer;
    color: var(--text);
    transition:
      background-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .dropdown-option:hover {
    background: var(--accent-soft);
  }
  .dropdown-option.clear {
    color: var(--text-dim);
    text-align: center;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    margin-bottom: 4px;
  }
  .uploader-option {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .uploader-option.selected {
    color: var(--accent);
    font-weight: 600;
  }
  .uploader-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .uploader-count {
    font-size: 12px;
  }
</style>
