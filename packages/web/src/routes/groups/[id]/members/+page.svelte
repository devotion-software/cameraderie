<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatDate } from '$lib/format';
  import type { Group, Invite, Member } from '$lib/types';
  import Avatar from '$lib/components/Avatar.svelte';
  import { confirmDialog } from '$lib/confirm.svelte';

  const session = useSession();
  const groupId = $derived(page.params.id);

  let group = $state<Group | null>(null);
  let members = $state<Member[]>([]);
  let invites = $state<Invite[]>([]);
  let error = $state('');
  let loading = $state(true);

  let inviteUrl = $state('');
  let showInvite = $state(false);
  let inviteEmail = $state('');
  let inviteMaxUses = $state('');
  let invitingBusy = $state(false);

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
    try {
      const [g, m] = await Promise.all([
        api.get<{ group: Group }>(`/groups/${groupId}`),
        api.get<{ members: Member[] }>(`/groups/${groupId}/members`),
      ]);
      group = g.group;
      members = m.members;
      if (group.myRole === 'owner' || group.myRole === 'admin') {
        invites = (await api.get<{ invites: Invite[] }>(`/groups/${groupId}/invites`)).invites;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load members';
    } finally {
      loading = false;
    }
  }

  const amOwner = $derived(group?.myRole === 'owner');
  const amGroupAdmin = $derived(group?.myRole === 'owner' || group?.myRole === 'admin');
  const canInvite = $derived.by(() => {
    const u = $session.data?.user as { role?: string; canInviteMembers?: boolean } | undefined;
    return amGroupAdmin && !!u && (u.role === 'admin' || u.canInviteMembers === true);
  });

  async function createInvite(e: SubmitEvent) {
    e.preventDefault();
    invitingBusy = true;
    error = '';
    try {
      const email = inviteEmail.trim() || undefined;
      const maxUses = !email && inviteMaxUses.trim() ? Number(inviteMaxUses) : undefined;
      const res = await api.post<{ invite: Invite }>(`/groups/${groupId}/invites`, {
        email,
        maxUses,
      });
      inviteUrl = `${location.origin}/invite/${res.invite.code}`;
      invites = [...invites, res.invite];
      inviteEmail = '';
      inviteMaxUses = '';
      showInvite = false;
      await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create invite';
    } finally {
      invitingBusy = false;
    }
  }

  let copiedInviteId = $state('');

  async function copyInviteLink(invite: Invite) {
    const url = `${location.origin}/invite/${invite.code}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    copiedInviteId = invite.id;
    setTimeout(() => {
      if (copiedInviteId === invite.id) copiedInviteId = '';
    }, 1500);
  }

  async function revokeInvite(inviteId: string) {
    const ok = await confirmDialog({
      title: 'Revoke invite',
      message: 'Revoke this invite? The link will stop working.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/groups/${groupId}/invites/${inviteId}`);
      invites = invites.filter((i) => i.id !== inviteId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to revoke invite';
    }
  }

  async function remove(userId: string) {
    const ok = await confirmDialog({
      title: 'Remove member',
      message: 'Remove this member?',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/groups/${groupId}/members/${userId}`);
      members = members.filter((m) => m.userId !== userId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to remove member';
    }
  }
</script>

{#if group}
  <div class="head">
    <div>
      <a href="/groups/{groupId}" class="back"><span class="arrow">←</span> {group.name}</a>
      <h1>Members</h1>
    </div>
    <span class="spacer"></span>
    {#if canInvite && !showInvite}
      <button class="btn secondary" onclick={() => (showInvite = true)}>Invite</button>
    {/if}
  </div>
{/if}

{#if showInvite}
  <form class="card invite-form" onsubmit={createInvite} transition:slide={{ duration: 180 }}>
    <input
      class="input"
      type="email"
      placeholder="Email to invite (optional — leave blank for a shareable link)"
      bind:value={inviteEmail}
    />
    {#if !inviteEmail.trim()}
      <input
        class="input max-uses"
        type="number"
        min="1"
        max="1000"
        placeholder="Max uses (optional)"
        bind:value={inviteMaxUses}
      />
    {/if}
    <button class="btn" type="submit" disabled={invitingBusy}>
      {invitingBusy ? 'Creating…' : 'Create invite'}
    </button>
    <button
      class="btn ghost"
      type="button"
      onclick={() => (showInvite = false)}
      disabled={invitingBusy}
    >
      Cancel
    </button>
  </form>
{/if}

{#if inviteUrl}
  <div class="card invite" transition:slide={{ duration: 180 }}>
    <span class="muted">Invite link (copied):</span>
    <code>{inviteUrl}</code>
  </div>
{/if}

{#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}

{#if !loading && amGroupAdmin && invites.length > 0}
  <h2 class="section-heading">Pending invites</h2>
  <div class="list invite-list">
    {#each invites as i (i.id)}
      <div class="card invite-row" transition:slide={{ duration: 180 }} animate:flip={{ duration: 200 }}>
        <div class="who">
          <strong>{i.inviteeEmail ?? 'Shareable link'}</strong>
          <span class="muted"
            >{i.uses}{i.maxUses !== null ? ` / ${i.maxUses}` : ''} used · created {formatDate(
              i.createdAt,
            )}{i.expiresAt ? ` · expires ${formatDate(i.expiresAt)}` : ''}</span
          >
        </div>
        <button class="btn secondary" onclick={() => copyInviteLink(i)}>
          {copiedInviteId === i.id ? 'Copied!' : 'Copy link'}
        </button>
        <button class="btn danger" onclick={() => revokeInvite(i.id)}>Revoke</button>
      </div>
    {/each}
  </div>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="list">
    {#each members as m (m.userId)}
      <div class="card member" transition:slide={{ duration: 180 }} animate:flip={{ duration: 200 }}>
        <Avatar name={m.name} src={m.avatarUrl} size={38} />
        <div class="who">
          <strong>{m.name}</strong>
          <span class="muted">{m.email}</span>
        </div>
        <span class="badge">{m.role}</span>
        <span class="muted photos">{m.photoCount} photo{m.photoCount === 1 ? '' : 's'}</span>
        <span class="muted joined">joined {formatDate(m.joinedAt)}</span>
        {#if amOwner && m.role !== 'owner' && m.userId !== $session.data?.user?.id}
          <button class="btn danger" onclick={() => remove(m.userId)}>Remove</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .section-heading {
    font-size: 15px;
    margin: 0 0 10px;
  }
  .invite-list {
    margin-bottom: 20px;
  }
  .invite-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
  }
  .invite-row .who {
    flex: 1;
    min-width: 0;
  }
  .invite-row .muted {
    font-size: 12px;
  }
  .invite {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 16px;
    padding: 12px 16px;
  }
  .invite-form {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
    padding: 14px 16px;
  }
  .invite-form .input {
    flex: 1;
  }
  .invite-form .max-uses {
    flex: 0 0 140px;
  }
  .invite code {
    color: var(--accent);
    word-break: break-all;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .member {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 14px;
    padding: 12px 16px;
  }
  .who {
    display: flex;
    flex-direction: column;
    flex: 1 1 160px;
    min-width: 0;
  }
  .who strong,
  .who .muted {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who .muted {
    font-size: 13px;
  }
  .photos,
  .joined {
    font-size: 12px;
  }
  .member :global(.badge) {
    margin-left: auto;
  }
  @media (max-width: 480px) {
    .member :global(.badge) {
      margin-left: 0;
    }
  }
</style>
