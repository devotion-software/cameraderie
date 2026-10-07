<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession, signOut } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatBytes } from '$lib/format';
  import type { Usage } from '$lib/types';

  const session = useSession();
  let usage = $state<Usage | null>(null);
  let error = $state('');
  let deleting = $state(false);

  // Plan tiers mirror @cameraderie/shared PLANS.
  const PLANS = [
    { id: 'free', label: 'Free', quota: '5 GB' },
    { id: 'pro', label: 'Pro', quota: '100 GB' },
    { id: 'max', label: 'Max', quota: '1 TB' },
  ];

  $effect(() => {
    if ($session.isPending) return;
    if (!$session.data?.user) {
      goto('/login', { replaceState: true });
      return;
    }
    void load();
  });

  async function load() {
    try {
      usage = await api.get<Usage>('/me/usage');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load usage';
    }
  }

  let upgradingTo = $state<string | null>(null);
  async function upgrade(plan: string) {
    upgradingTo = plan;
    error = '';
    try {
      const res = await api.post<{ url: string }>('/billing/checkout', { plan });
      if (res.url) location.href = res.url;
    } catch (err) {
      error =
        err instanceof Error
          ? `${err.message} (billing may not be configured yet)`
          : 'Checkout failed';
      upgradingTo = null;
    }
  }

  async function deleteAccount() {
    if (
      !confirm(
        'Delete your account and all your uploads permanently? This cannot be undone. Groups you own pass to the next member, or are deleted if empty.',
      )
    )
      return;
    deleting = true;
    try {
      await api.del('/me');
      await signOut().catch(() => {});
      goto('/login', { replaceState: true });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete account';
      deleting = false;
    }
  }

  const usedPct = $derived(usage ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100) : 0);
</script>

<h1>Settings</h1>

{#if error}<p class="error">{error}</p>{/if}

{#if usage}
  <section class="card">
    <h2>Storage</h2>
    <div class="row">
      <span class="muted">{formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}</span>
      <span class="spacer"></span>
      <span class="badge">{usage.plan}</span>
    </div>
    <div class="bar"><div class="fill" style="width: {usedPct}%"></div></div>
    {#if usage.readOnly}
      <p class="muted">Over quota — uploads paused until you free space or upgrade.</p>
    {/if}
  </section>

  <section class="card">
    <h2>Plans</h2>
    <div class="plans">
      {#each PLANS as p (p.id)}
        <div class="plan" class:current={p.id === usage.plan}>
          <strong>{p.label}</strong>
          <span class="muted">{p.quota}</span>
          {#if p.id === usage.plan}
            <span class="badge">Current</span>
          {:else if p.id !== 'free'}
            <button class="btn" onclick={() => upgrade(p.id)} disabled={upgradingTo !== null}>
              {upgradingTo === p.id ? 'Redirecting…' : 'Upgrade'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
    <p class="muted small">
      Web upgrades go through Stripe Checkout; mobile uses in-app purchase via RevenueCat. Quota is
      derived from your entitlement.
    </p>
  </section>
{/if}

<section class="card danger-zone">
  <h2>Danger zone</h2>
  <p class="muted">
    Deleting your account removes all your uploads everywhere. Originals are erased from storage.
  </p>
  <button class="btn danger" onclick={deleteAccount} disabled={deleting}>
    {deleting ? 'Deleting…' : 'Delete my account'}
  </button>
</section>

<style>
  h2 {
    margin-top: 0;
    font-size: 16px;
  }
  section {
    margin-bottom: 16px;
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
    background: var(--accent);
  }
  .plans {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
  .plan {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .plan.current {
    border-color: var(--accent);
  }
  .small {
    font-size: 13px;
    margin-bottom: 0;
  }
  .danger-zone {
    border-color: rgba(255, 107, 107, 0.4);
  }
</style>
