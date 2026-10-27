<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession, signOut, authClient } from '$lib/auth';
  import { api } from '$lib/api';
  import { API_URL } from '$lib/config';
  import type { Usage } from '$lib/types';
  import StoragePanel from '$lib/components/StoragePanel.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';

  const session = useSession();
  let usage = $state<Usage | null>(null);
  let error = $state('');
  let deleting = $state(false);
  let exporting = $state(false);

  let name = $state('');
  let nameLoaded = false;
  let savingName = $state(false);
  let nameSaved = $state(false);

  $effect(() => {
    if (!nameLoaded && $session.data?.user?.name) {
      name = $session.data.user.name;
      nameLoaded = true;
    }
  });

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    savingName = true;
    nameSaved = false;
    error = '';
    try {
      const res = await authClient.updateUser({ name: trimmed });
      if (res.error) throw new Error(res.error.message ?? 'Failed to update name');
      name = trimmed;
      nameSaved = true;
      setTimeout(() => (nameSaved = false), 2000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update name';
    } finally {
      savingName = false;
    }
  }

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

  async function exportData() {
    exporting = true;
    error = '';
    try {
      const res = await fetch(`${API_URL}/me/export`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cameraderie-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Export failed';
    } finally {
      exporting = false;
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

</script>

<h1>Settings</h1>

{#if error}<p class="error">{error}</p>{/if}

<section class="card">
  <h2>Profile</h2>
  <form class="row" onsubmit={saveName}>
    <input class="input" bind:value={name} maxlength={255} placeholder="Your name" required />
    <button class="btn secondary" type="submit" disabled={savingName || !name.trim()}>
      {savingName ? 'Saving…' : nameSaved ? 'Saved ✓' : 'Save'}
    </button>
  </form>
</section>

<section class="card">
  <h2>Appearance</h2>
  <div class="row">
    <span class="muted">Switch between light and dark mode.</span>
    <span class="spacer"></span>
    <ThemeToggle />
  </div>
</section>

{#if usage}
  <StoragePanel {usage} />

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

<section class="card">
  <h2>Your data</h2>
  <p class="muted">Download a copy of your account data at any time.</p>
  <button class="btn secondary" onclick={exportData} disabled={exporting}>
    {exporting ? 'Preparing…' : 'Export my data (JSON)'}
  </button>
</section>

<section class="card">
  <h2>Legal</h2>
  <div class="legal-links">
    <a class="legal-link" href="/legal/privacy">
      <span>Privacy Policy</span>
      <span class="chev">›</span>
    </a>
    <a class="legal-link" href="/legal/terms">
      <span>Terms of Service</span>
      <span class="chev">›</span>
    </a>
  </div>
</section>

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
  .plans {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
  .plan {
    border: 1px solid var(--border);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .plan.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-soft);
  }
  .small {
    font-size: 13px;
    margin-bottom: 0;
  }
  .danger-zone {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .legal-links {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .legal-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    font-weight: 600;
    font-size: 0.92rem;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      transform 0.15s ease;
  }
  .legal-link:hover {
    text-decoration: none;
    background: var(--surface-strong);
    border-color: var(--border-strong);
    transform: translateX(2px);
  }
  .legal-link .chev {
    color: var(--text-dim);
    font-size: 1.1rem;
  }
</style>
