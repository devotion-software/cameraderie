<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatBytes } from '$lib/format';
  import type { Group, Usage } from '$lib/types';

  const session = useSession();
  let groups = $state<Group[]>([]);
  let usage = $state<Usage | null>(null);
  let loading = $state(true);
  let error = $state('');

  let newName = $state('');
  let creating = $state(false);

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
      const [g, u] = await Promise.all([
        api.get<{ groups: Group[] }>('/groups'),
        api.get<Usage>('/me/usage'),
      ]);
      groups = g.groups;
      usage = u;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  async function createGroup(e: SubmitEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    creating = true;
    try {
      const res = await api.post<{ group: Group }>('/groups', { name: newName.trim() });
      newName = '';
      goto(`/groups/${res.group.id}`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create group';
    } finally {
      creating = false;
    }
  }

  const usedPct = $derived(usage ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100) : 0);
</script>

<div class="head">
  <h1>Your groups</h1>
</div>

{#if usage}
  <div class="card usage">
    <div class="row">
      <strong>Storage</strong>
      <span class="spacer"></span>
      <span class="muted">
        {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} · {usage.plan}
      </span>
    </div>
    <div class="bar"><div class="fill" style="width: {usedPct}%"></div></div>
    {#if usage.readOnly}
      <p class="muted" style="margin:8px 0 0">
        You're over quota — viewing and downloads still work, but new uploads are paused.
      </p>
    {/if}
  </div>
{/if}

<form class="create card" onsubmit={createGroup}>
  <input class="input" placeholder="New group name…" bind:value={newName} maxlength={80} />
  <button class="btn" type="submit" disabled={creating || !newName.trim()}>Create</button>
</form>

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if groups.length === 0}
  <p class="muted">No groups yet. Create one above to start sharing.</p>
{:else}
  <div class="group-list">
    {#each groups as g (g.id)}
      <a class="card group" href="/groups/{g.id}">
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
  .usage {
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
  .create {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    padding: 14px;
  }
  .group-list {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  .group:hover {
    text-decoration: none;
    border-color: var(--accent);
  }
</style>
