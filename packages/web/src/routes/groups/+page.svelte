<script lang="ts">
  import { slide } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import type { Group, MyInvite, Usage } from '$lib/types';
  import StoragePanel from '$lib/components/StoragePanel.svelte';

  const session = useSession();
  let groups = $state<Group[]>([]);
  let usage = $state<Usage | null>(null);
  let invites = $state<MyInvite[]>([]);
  let loading = $state(true);
  let error = $state('');
  let respondingTo = $state<string | null>(null);

  let newName = $state('');
  let creating = $state(false);
  let showCreate = $state(false);
  let showStorage = $state(false);
  let nameInput = $state<HTMLInputElement>();

  function openCreate() {
    showCreate = true;
    requestAnimationFrame(() => nameInput?.focus());
  }

  function closeCreate() {
    showCreate = false;
    newName = '';
  }

  $effect(() => {
    if ($session.isPending) return;
    if (!$session.data?.user) {
      goto('/login', { replaceState: true });
      return;
    }
    void load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const [g, u, i] = await Promise.all([
        api.get<{ groups: Group[] }>('/groups'),
        api.get<Usage>('/me/usage'),
        api.get<{ invites: MyInvite[] }>('/me/invites'),
      ]);
      groups = g.groups;
      usage = u;
      invites = i.invites;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  async function acceptInvite(invite: MyInvite) {
    respondingTo = invite.id;
    try {
      await api.post<{ groupId: string }>(`/invites/${invite.code}/accept`);
      invites = invites.filter((inv) => inv.id !== invite.id);
      goto(`/groups/${invite.groupId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not join';
    } finally {
      respondingTo = null;
    }
  }

  async function declineInvite(invite: MyInvite) {
    respondingTo = invite.id;
    try {
      await api.post(`/invites/${invite.code}/decline`);
      invites = invites.filter((inv) => inv.id !== invite.id);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not decline invite';
    } finally {
      respondingTo = null;
    }
  }

  const canCreateGroups = $derived.by(() => {
    const u = $session.data?.user as { role?: string; canCreateGroups?: boolean } | undefined;
    return !!u && (u.role === 'admin' || u.canCreateGroups === true);
  });

  async function createGroup(e: SubmitEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    creating = true;
    try {
      const res = await api.post<{ group: Group }>('/groups', { name: newName.trim() });
      newName = '';
      showCreate = false;
      goto(`/groups/${res.group.id}`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create group';
    } finally {
      creating = false;
    }
  }
</script>

<div class="head row">
  <div>
    <h1>Your groups</h1>
  </div>
  <span class="spacer"></span>
  {#if usage}
    <button
      class="btn secondary"
      class:active={showStorage}
      onclick={() => (showStorage = !showStorage)}
    >
      Storage
    </button>
  {/if}
  {#if canCreateGroups && !showCreate}
    <button class="btn" onclick={openCreate}>+ New group</button>
  {/if}
</div>

{#if usage && showStorage}
  <div transition:slide={{ duration: 180 }}>
    <StoragePanel {usage} />
  </div>
{/if}

{#if showCreate}
  <form class="create card" onsubmit={createGroup} transition:slide={{ duration: 180 }}>
    <input
      class="input"
      placeholder="New group name…"
      bind:value={newName}
      bind:this={nameInput}
      maxlength={80}
    />
    <button class="btn" type="submit" disabled={creating || !newName.trim()}>
      {creating ? 'Creating…' : 'Create'}
    </button>
    <button class="btn ghost" type="button" onclick={closeCreate} disabled={creating}>Cancel</button
    >
  </form>
{/if}

{#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}

{#if invites.length > 0}
  <div class="invite-list" transition:slide={{ duration: 180 }}>
    {#each invites as invite (invite.id)}
      <div class="card invite">
        <span>You've been invited to join <strong>{invite.groupName}</strong>.</span>
        <span class="spacer"></span>
        <button
          class="btn secondary"
          onclick={() => declineInvite(invite)}
          disabled={respondingTo === invite.id}
        >
          Decline
        </button>
        <button
          class="btn"
          onclick={() => acceptInvite(invite)}
          disabled={respondingTo === invite.id}
        >
          {respondingTo === invite.id ? 'Joining…' : 'Accept'}
        </button>
      </div>
    {/each}
  </div>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if groups.length === 0}
  <p class="muted">{canCreateGroups ? 'No groups yet. Create one above to start sharing.' : 'No groups yet.'}</p>
{:else}
  <div class="group-list">
    {#each groups as g (g.id)}
      <a class="card group" href="/groups/{g.id}">
        {#if g.coverThumbnailUrl}
          <img class="cover" src={g.coverThumbnailUrl} alt="" />
        {:else}
          <div class="cover placeholder"></div>
        {/if}
        <strong>{g.name}</strong>
        {#if g.description}<span class="muted">{g.description}</span>{/if}
        <span class="badge">{g.myRole}</span>
      </a>
    {/each}
  </div>
{/if}

<style>
  .head {
    margin-bottom: 16px;
  }
  .btn.secondary.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-soft);
  }
  .create {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    padding: 14px;
  }
  .invite-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 20px;
  }
  .invite {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    border-color: var(--accent);
  }
  .group-list {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    overflow: hidden;
    transition:
      transform 0.2s cubic-bezier(0.2, 0.8, 0.3, 1),
      box-shadow 0.2s ease,
      border-color 0.2s ease;
  }
  .cover {
    width: calc(100% + 44px);
    margin: -22px -22px 6px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    background: var(--surface-2);
  }
  .cover.placeholder {
    background: linear-gradient(135deg, var(--accent-soft), transparent 70%);
  }
  .group strong {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
  }
  .group:hover {
    text-decoration: none;
    border-color: var(--accent);
    transform: translateY(-4px);
    box-shadow:
      0 16px 40px -16px hsl(var(--shadow-color) / 0.45),
      inset 0 1px 0 var(--glass-highlight);
  }
</style>
