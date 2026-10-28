<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { useSession, signOut } from '$lib/auth';
  import { api } from '$lib/api';
  import type { Profile } from '$lib/types';
  import Avatar from '$lib/components/Avatar.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  let { children } = $props();
  const session = useSession();

  let avatarUrl = $state<string | null>(null);
  let avatarLoadedFor: string | null = null;

  $effect(() => {
    const id = $session.data?.user?.id;
    if (id && avatarLoadedFor !== id) {
      avatarLoadedFor = id;
      api
        .get<{ user: Profile }>('/me')
        .then((res) => (avatarUrl = res.user.avatarUrl))
        .catch(() => {});
    }
  });

  // 18+/Terms consent is captured right after sign-in (not during it, since
  // email OTP/Google/Apple/passkey can't carry that form field through to
  // account creation) — send anyone missing it to the consent interstitial.
  // The server enforces this too (every /api route 403s until it's set).
  $effect(() => {
    const user = $session.data?.user as { acceptedTermsAt?: unknown } | undefined;
    if (
      user &&
      !user.acceptedTermsAt &&
      !page.url.pathname.startsWith('/consent') &&
      !page.url.pathname.startsWith('/legal')
    ) {
      goto('/consent');
    }
  });

  async function handleSignOut() {
    await signOut();
    goto('/login');
  }
</script>

<header class="topbar">
  <div class="topbar-inner glass">
    <a class="brand" href="/">
      <span class="brand-word">Cameraderie</span>
    </a>
    <div class="spacer"></div>
    {#if $session.data?.user}
      <nav class="navlinks">
        <a href="/groups" class="navlink" class:active={page.url.pathname.startsWith('/groups')}>
          Groups
        </a>
        {#if ($session.data.user as { role?: string }).role === 'admin'}
          <a
            href="/admin/reports"
            class="navlink"
            class:active={page.url.pathname.startsWith('/admin/reports')}
          >
            Reports
          </a>
          <a
            href="/admin/users"
            class="navlink"
            class:active={page.url.pathname.startsWith('/admin/users')}
          >
            Users
          </a>
        {/if}
        <a
          href="/settings"
          class="navlink"
          class:active={page.url.pathname.startsWith('/settings')}
        >
          Settings
        </a>
      </nav>
      <div class="account">
        <Avatar name={$session.data.user.name} src={avatarUrl} size={28} />
        <span class="account-name">{$session.data.user.name}</span>
      </div>
      <button class="btn ghost" onclick={handleSignOut}>Sign out</button>
    {:else}
      <a href="/login" class="btn secondary">Sign in</a>
    {/if}
  </div>
</header>

<main class="container">
  {@render children()}
</main>

<ConfirmDialog />

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 14px 20px 0;
  }
  .glass {
    background: var(--surface-strong);
    backdrop-filter: blur(var(--glass-blur)) saturate(160%);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(160%);
    border: 1px solid var(--border);
    box-shadow:
      0 8px 32px -14px hsl(var(--shadow-color) / 0.35),
      inset 0 1px 0 var(--glass-highlight);
  }
  .topbar-inner {
    max-width: var(--maxw);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 12px 22px;
    border-radius: 999px;
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text);
  }
  .brand:hover {
    text-decoration: none;
  }
  .brand-word {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: -0.01em;
    background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .navlinks {
    display: flex;
    gap: 22px;
  }
  .navlink {
    color: var(--text-dim);
    font-weight: 600;
    font-size: 0.93rem;
    position: relative;
    padding: 4px 0;
    transition: color var(--dur-fast) ease;
  }
  .navlink:hover {
    text-decoration: none;
    color: var(--text);
  }
  .navlink.active {
    color: var(--text);
  }
  .navlink.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -3px;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
  }
  .account {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 14px 5px 6px;
    margin-left: 4px;
    border-radius: 999px;
    background: var(--accent-soft);
    border: 1px solid var(--border-strong);
  }
  .account-name {
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-dim);
    cursor: default;
  }
  @media (max-width: 680px) {
    .navlinks {
      gap: 14px;
    }
    .account-name {
      display: none;
    }
    .account {
      padding: 5px;
    }
  }
</style>
