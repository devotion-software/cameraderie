<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession, signOut, authClient } from '$lib/auth';
  import { api } from '$lib/api';
  import { API_URL } from '$lib/config';
  import type { Profile, Usage } from '$lib/types';
  import type { DownloadQuality } from '@cameraderie/shared';
  import StoragePanel from '$lib/components/StoragePanel.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import AvatarUpload from '$lib/components/AvatarUpload.svelte';
  import Dropdown from '$lib/components/Dropdown.svelte';
  import { QUALITY_OPTIONS } from '$lib/download';
  import { slide } from 'svelte/transition';
  import { confirmDialog } from '$lib/confirm.svelte';

  const session = useSession();
  let usage = $state<Usage | null>(null);
  let profile = $state<Profile | null>(null);
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

  function setAvatarUrl(avatarUrl: string | null) {
    if (profile) profile = { ...profile, avatarUrl };
  }

  let savingDownloadQuality = $state(false);
  async function saveDownloadQuality(defaultDownloadQuality: DownloadQuality) {
    if (!profile) return;
    profile = { ...profile, defaultDownloadQuality };
    savingDownloadQuality = true;
    try {
      await api.patch('/me/download-quality', { defaultDownloadQuality });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save default download quality';
    } finally {
      savingDownloadQuality = false;
    }
  }

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

  const passkeys = authClient.useListPasskeys();
  let addingPasskey = $state(false);

  async function addPasskey() {
    addingPasskey = true;
    error = '';
    try {
      const res = await authClient.passkey.addPasskey();
      if (res?.error) throw new Error(res.error.message ?? 'Failed to add passkey');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to add passkey';
    } finally {
      addingPasskey = false;
    }
  }

  async function removePasskey(id: string) {
    error = '';
    try {
      const res = await authClient.$fetch('/passkey/delete-passkey', {
        method: 'POST',
        body: { id },
      });
      if (res.error) throw new Error(res.error.message ?? 'Failed to remove passkey');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to remove passkey';
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
      const [u, p] = await Promise.all([
        api.get<Usage>('/me/usage'),
        api.get<{ user: Profile }>('/me'),
      ]);
      usage = u;
      profile = p.user;
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
    const ok = await confirmDialog({
      title: 'Delete account',
      message:
        'Delete your account and all your uploads permanently? This cannot be undone. Groups you own pass to the next member, or are deleted if empty.',
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
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

{#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}

<section class="card">
  <h2>Profile</h2>
  {#if profile}
    <div class="avatar-section">
      <AvatarUpload name={profile.name} avatarUrl={profile.avatarUrl} onUpdated={setAvatarUrl} />
    </div>
  {/if}
  <form class="name-form" onsubmit={saveName}>
    <label for="settings-name">Name</label>
    <div class="row">
      <input
        id="settings-name"
        class="input"
        bind:value={name}
        maxlength={255}
        placeholder="Your name"
        required
      />
      <button class="btn secondary" type="submit" disabled={savingName || !name.trim()}>
        {savingName ? 'Saving…' : nameSaved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  </form>
</section>

<section class="card">
  <h2>Downloads</h2>
  {#if profile}
    <div class="quality-field">
      <span class="quality-label">Default download quality</span>
      <Dropdown
        options={QUALITY_OPTIONS}
        value={profile.defaultDownloadQuality}
        onchange={saveDownloadQuality}
        label="Default download quality"
      />
    </div>
    <p class="muted small">
      Used to preselect quality when downloading, and for the 'd' shortcut on a photo.
    </p>
  {/if}
</section>

<section class="card">
  <h2>Sign-in methods</h2>
  <p class="muted">Passkeys let you sign in with Face ID, Touch ID, or a security key.</p>
  {#if $passkeys.data?.length}
    <ul class="passkey-list">
      {#each $passkeys.data as pk (pk.id)}
        <li>
          <span>{pk.name || 'Passkey'}</span>
          <button class="btn ghost" onclick={() => removePasskey(pk.id)}>Remove</button>
        </li>
      {/each}
    </ul>
  {/if}
  <button class="btn secondary" onclick={addPasskey} disabled={addingPasskey}>
    {addingPasskey ? 'Follow your browser prompt…' : 'Add a passkey'}
  </button>
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
  <p class="app-version muted small">Cameraderie v{__APP_VERSION__}</p>
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
  .avatar-section {
    margin-bottom: 20px;
  }
  .name-form label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-dim);
    margin-bottom: 6px;
  }
  .quality-field {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .quality-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-dim);
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
  .app-version {
    margin-top: 12px;
  }
  .passkey-list {
    list-style: none;
    margin: 12px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .passkey-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-size: 0.92rem;
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
