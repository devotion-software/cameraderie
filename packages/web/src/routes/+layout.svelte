<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { useSession, signOut } from '$lib/auth';

  let { children } = $props();
  const session = useSession();

  async function handleSignOut() {
    await signOut();
    goto('/login');
  }
</script>

<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="/">📷 Cameraderie</a>
    <div class="spacer"></div>
    {#if $session.data?.user}
      <a href="/groups" class="navlink" class:active={page.url.pathname.startsWith('/groups')}>
        Groups
      </a>
      {#if ($session.data.user as { role?: string }).role === 'admin'}
        <a href="/admin/reports" class="navlink" class:active={page.url.pathname.startsWith('/admin')}>
          Admin
        </a>
      {/if}
      <a href="/settings" class="navlink" class:active={page.url.pathname.startsWith('/settings')}>
        Settings
      </a>
      <span class="muted email">{$session.data.user.email}</span>
      <button class="btn ghost" onclick={handleSignOut}>Sign out</button>
    {:else}
      <a href="/login" class="btn secondary">Sign in</a>
    {/if}
  </div>
</header>

<main class="container">
  {@render children()}
</main>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(15, 15, 18, 0.85);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }
  .topbar-inner {
    max-width: var(--maxw);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
  }
  .brand {
    font-weight: 700;
    font-size: 17px;
    color: var(--text);
  }
  .brand:hover {
    text-decoration: none;
  }
  .navlink {
    color: var(--text-dim);
    font-weight: 600;
  }
  .navlink.active {
    color: var(--text);
  }
  .email {
    font-size: 13px;
  }
  @media (max-width: 560px) {
    .email {
      display: none;
    }
  }
</style>
