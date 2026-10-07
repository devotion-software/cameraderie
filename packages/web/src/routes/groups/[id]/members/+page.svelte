<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatDate } from '$lib/format';
  import type { Group, Member } from '$lib/types';

  const session = useSession();
  const groupId = $derived(page.params.id);

  let group = $state<Group | null>(null);
  let members = $state<Member[]>([]);
  let error = $state('');
  let loading = $state(true);

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
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load members';
    } finally {
      loading = false;
    }
  }

  const amOwner = $derived(group?.myRole === 'owner');

  async function remove(userId: string) {
    if (!confirm('Remove this member?')) return;
    try {
      await api.del(`/groups/${groupId}/members/${userId}`);
      members = members.filter((m) => m.userId !== userId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to remove member';
    }
  }
</script>

{#if group}
  <a href="/groups/{groupId}" class="muted back">← {group.name}</a>
  <h1>Members</h1>
{/if}

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="list">
    {#each members as m (m.userId)}
      <div class="card member">
        <div class="avatar">{m.name.slice(0, 1).toUpperCase()}</div>
        <div class="who">
          <strong>{m.name}</strong>
          <span class="muted">{m.email}</span>
        </div>
        <span class="badge">{m.role}</span>
        <span class="muted joined">joined {formatDate(m.joinedAt)}</span>
        {#if amOwner && m.role !== 'owner' && m.userId !== $session.data?.user?.id}
          <button class="btn danger" onclick={() => remove(m.userId)}>Remove</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .back {
    font-size: 13px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .member {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
  }
  .avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex: 0 0 auto;
  }
  .who {
    display: flex;
    flex-direction: column;
  }
  .who .muted {
    font-size: 13px;
  }
  .joined {
    font-size: 12px;
  }
  .member :global(.badge) {
    margin-left: auto;
  }
</style>
