<script lang="ts" generics="T extends string">
  import { fade, scale } from 'svelte/transition';

  interface Option {
    value: T;
    label: string;
  }

  interface Props {
    options: Option[];
    value: T;
    onchange?: (value: T) => void;
    label?: string;
    id?: string;
  }
  let { options, value = $bindable(), onchange, label, id }: Props = $props();

  let open = $state(false);
  let highlighted = $state(0);
  let trigger = $state<HTMLButtonElement | null>(null);
  let listbox = $state<HTMLUListElement | null>(null);

  const selectedOption = $derived(
    options.find((o) => o.value === value) ?? options[0] ?? null,
  );

  function openMenu() {
    if (options.length === 0) return;
    highlighted = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    open = true;
  }

  function closeMenu(refocus = false) {
    open = false;
    if (refocus) trigger?.focus();
  }

  function toggleMenu() {
    if (open) closeMenu();
    else openMenu();
  }

  function choose(option: Option) {
    value = option.value;
    onchange?.(option.value);
    closeMenu(true);
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = Math.min(highlighted + 1, options.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const option = options[highlighted];
      if (option) choose(option);
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const target = e.target as Node;
    if (trigger?.contains(target) || listbox?.contains(target)) return;
    closeMenu();
  }

  $effect(() => {
    if (open) listbox?.focus();
  });
</script>

<svelte:window onclick={onDocClick} />

<div class="dropdown">
  <button
    bind:this={trigger}
    type="button"
    {id}
    class="dropdown-trigger"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    onclick={toggleMenu}
    onkeydown={onTriggerKeydown}
  >
    <span class="dropdown-value">{selectedOption?.label ?? ''}</span>
    <svg class="dropdown-caret" width="10" height="6" viewBox="0 0 10 6" fill="none">
      <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  </button>
  {#if open}
    <ul
      bind:this={listbox}
      class="dropdown-list"
      role="listbox"
      tabindex="-1"
      aria-label={label}
      onkeydown={onListKeydown}
      transition:fade={{ duration: 120 }}
    >
      {#each options as option, i (option.value)}
        <li
          role="option"
          aria-selected={option.value === value}
          class="dropdown-option"
          class:active={i === highlighted}
          class:selected={option.value === value}
          onmouseenter={() => (highlighted = i)}
          onclick={() => choose(option)}
        >
          {option.label}
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
    min-width: 140px;
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
      background 0.15s ease;
  }
  .dropdown-trigger:hover {
    border-color: var(--accent);
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
    left: 0;
    top: calc(100% + 6px);
    z-index: 100;
    min-width: 100%;
    max-height: 260px;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
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
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .dropdown-option.active {
    background: var(--surface-2);
  }
  .dropdown-option.selected {
    color: var(--accent);
    font-weight: 600;
  }
</style>
