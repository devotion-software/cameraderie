<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatDate } from '$lib/format';
  import type { AdminUser } from '$lib/types';
  import { confirmDialog } from '$lib/confirm.svelte';

  const session = useSession();
  let rows = $state<AdminUser[]>([]);
  let loading = $state(true);
  let error = $state('');
  let savingId = $state<string | null>(null);

  $effect(() => {
    if ($session.isPending) return;
    const user = $session.data?.user as { role?: string } | undefined;
    if (!user) {
      goto('/login', { replaceState: true });
      return;
    }
    if (user.role !== 'admin') {
      error = 'Admin access required.';
      loading = false;
      return;
    }
    void load();
  });

  async function load() {
    loading = true;
    try {
      const res = await api.get<{ users: AdminUser[] }>('/admin/users');
      rows = res.users;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load users';
    } finally {
      loading = false;
    }
  }

  interface UserPatch {
    role?: 'user' | 'admin';
    canCreateGroups?: boolean;
    canInviteMembers?: boolean;
    disabled?: boolean;
  }

  async function update(id: string, patch: UserPatch) {
    savingId = id;
    error = '';
    try {
      const res = await api.patch<{ user: AdminUser }>(`/admin/users/${id}`, patch);
      rows = rows.map((r) => (r.id === id ? res.user : r));
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update user';
    } finally {
      savingId = null;
    }
  }

  function toggleRole(u: AdminUser) {
    void update(u.id, { role: u.role === 'admin' ? 'user' : 'admin' });
  }

  async function toggleDisabled(u: AdminUser) {
    const next = !u.disabledAt;
    if (next) {
      const ok = await confirmDialog({
        title: 'Deactivate user',
        message: `Deactivate ${u.name}? They won't be able to sign in or use the app.`,
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    void update(u.id, { disabled: next });
  }
</script>

<h1>Users</h1>
<p class="muted">
  Control who can create new groups and invite new members. Site admins always have both.
</p>

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="list">
    {#each rows as u (u.id)}
      <div class="card user">
        <div class="who">
          <strong>{u.name}</strong>
          {#if u.disabledAt}<span class="badge disabled">Deactivated</span>{/if}
          <span class="muted">{u.email}</span>
          <span class="muted small">joined {formatDate(u.createdAt)}</span>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={u.role === 'admin'}
            disabled={savingId === u.id}
            onchange={() => toggleRole(u)}
          />
          <span>Site admin</span>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            checked={u.role === 'admin' || u.canCreateGroups}
            disabled={savingId === u.id || u.role === 'admin'}
            onchange={(e) =>
              update(u.id, { canCreateGroups: (e.target as HTMLInputElement).checked })}
          />
          <span>Can create groups</span>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            checked={u.role === 'admin' || u.canInviteMembers}
            disabled={savingId === u.id || u.role === 'admin'}
            onchange={(e) =>
              update(u.id, { canInviteMembers: (e.target as HTMLInputElement).checked })}
          />
          <span>Can invite members</span>
        </label>
        <button
          class="btn danger"
          disabled={savingId === u.id || u.role === 'admin'}
          onclick={() => toggleDisabled(u)}
        >
          {u.disabledAt ? 'Reactivate' : 'Deactivate'}
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .who .badge.disabled {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    align-self: flex-start;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .user {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 14px 18px;
    flex-wrap: wrap;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 200px;
    flex: 1;
  }
  .who .muted {
    font-size: 13px;
  }
  .small {
    font-size: 12px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
    white-space: nowrap;
  }
</style>
