<script lang="ts">
  import { scale } from 'svelte/transition';

  let theme = $state<'light' | 'dark'>('light');

  $effect(() => {
    theme = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light';
  });

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cam-theme', theme);
  }
</script>

<button
  class="theme-toggle"
  onclick={toggle}
  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
>
  {#if theme === 'dark'}
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      in:scale={{ duration: 200, start: 0.5 }}
    >
      <circle cx="12" cy="12" r="4.5" />
      <path
        stroke-linecap="round"
        d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
      />
    </svg>
  {:else}
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      in:scale={{ duration: 200, start: 0.5 }}
    >
      <path d="M20.6 15.3a8.6 8.6 0 0 1-10-11.9A9.1 9.1 0 1 0 20.6 15.3Z" />
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: var(--surface-strong);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    color: var(--text);
    cursor: pointer;
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    transition:
      background 0.15s ease,
      transform 0.25s cubic-bezier(0.2, 0.8, 0.3, 1.4);
  }
  .theme-toggle:hover {
    transform: scale(1.08) rotate(-10deg);
  }
</style>
