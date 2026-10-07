<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';

  const session = useSession();
  const code = $derived(page.params.code);

  let groupName = $state('');
  let expired = $state(false);
  let error = $state('');
  let loading = $state(true);
  let joining = $state(false);

  $effect(() => {
    if ($session.isPending) return;
    if (!$session.data?.user) {
      // Preserve the invite so we can return after sign-in.
      goto(`/login?redirect=/invite/${code}`, { replaceState: true });
      return;
    }
    void preview();
  });

  async function preview() {
    loading = true;
    try {
      const res = await api.get<{ group: { name: string }; expired: boolean }>(`/invites/${code}`);
      groupName = res.group.name;
      expired = res.expired;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Invite not found';
    } finally {
      loading = false;
    }
  }

  async function accept() {
    joining = true;
    try {
      const res = await api.post<{ groupId: string }>(`/invites/${code}/accept`);
      goto(`/groups/${res.groupId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not join';
    } finally {
      joining = false;
    }
  }
</script>

<div class="wrap">
  <div class="card">
    {#if loading}
      <p class="muted">Loading invite…</p>
    {:else if error}
      <p class="error">{error}</p>
      <a class="btn secondary" href="/groups">Go to your groups</a>
    {:else}
      <h1>Join {groupName}</h1>
      {#if expired}
        <p class="error">This invite has expired.</p>
      {:else}
        <p class="muted">You've been invited to share photos and videos in this group.</p>
        <button class="btn" onclick={accept} disabled={joining}>
          {joining ? 'Joining…' : `Join ${groupName}`}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .wrap {
    max-width: 420px;
    margin: 48px auto;
  }
  h1 {
    margin-top: 0;
  }
  .btn {
    margin-top: 16px;
  }
</style>
