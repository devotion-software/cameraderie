<script lang="ts">
  interface Props {
    name: string;
    src?: string | null;
    size?: number;
  }
  const { name, src = null, size = 38 }: Props = $props();
  const initial = $derived(name.slice(0, 1).toUpperCase());
</script>

{#if src}
  <img class="avatar" style:width="{size}px" style:height="{size}px" {src} alt={name} />
{:else}
  <div class="avatar initials" style:width="{size}px" style:height="{size}px">{initial}</div>
{/if}

<style>
  .avatar {
    border-radius: 50%;
    flex: 0 0 auto;
    object-fit: cover;
    box-shadow: 0 4px 14px -4px hsl(var(--shadow-color) / 0.5);
  }
  .initials {
    background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
    color: var(--accent-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-family: var(--font-display);
  }
</style>
