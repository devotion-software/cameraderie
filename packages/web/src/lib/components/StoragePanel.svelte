<script lang="ts">
  import { formatBytes } from '$lib/format';
  import type { Usage } from '$lib/types';

  let { usage }: { usage: Usage } = $props();

  const usedPct = $derived(Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100));
</script>

<section class="card storage-panel">
  <h2>Storage</h2>
  <div class="row">
    <span class="muted"
      >{formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} used ({usedPct.toFixed(
        2,
      )}%)</span
    >
    <span class="spacer"></span>
    <span class="badge">{usage.plan}</span>
  </div>
  <div class="bar"><div class="fill" style="width: {usedPct}%"></div></div>
  {#if usage.readOnly}
    <p class="muted over">
      You're over quota — viewing and downloads still work, but new uploads are paused.
    </p>
  {/if}
</section>

<style>
  .storage-panel {
    margin-bottom: 16px;
  }
  h2 {
    margin-top: 0;
    font-size: 16px;
  }
  .bar {
    margin-top: 10px;
    height: 8px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
    box-shadow: 0 0 12px var(--accent-soft);
  }
  .over {
    margin: 10px 0 0;
  }
</style>
