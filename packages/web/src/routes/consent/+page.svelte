<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { authClient, useSession } from '$lib/auth';
  import { slide } from 'svelte/transition';

  const session = useSession();
  const redirectTo = $derived(page.url.searchParams.get('redirect') || '/groups');
  // Email OTP sign-up doesn't collect a name up front (see login page), so
  // ask for one here if it's still blank. Google/Apple sign-in already set
  // it from the provider profile.
  const needsName = $derived(!$session.data?.user?.name);

  let name = $state('');
  let confirmAdult = $state(false);
  let agreeTerms = $state(false);
  let error = $state('');
  let busy = $state(false);
  const canSubmit = $derived(confirmAdult && agreeTerms && (!needsName || name.trim().length > 0));

  $effect(() => {
    if (!$session.isPending && !$session.data?.user) goto('/login', { replaceState: true });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      if (needsName) {
        const res = await authClient.updateUser({ name: name.trim() });
        if (res.error) throw new Error(res.error.message ?? 'Failed to save name');
      }
      await api.post('/me/accept-terms');
      goto(redirectTo, { replaceState: true });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }
</script>

<div class="auth">
  <div class="card">
    <p class="eyebrow">One more thing</p>
    <h1>Before you continue</h1>
    <p class="muted">We need you to confirm a couple of things to finish setting up your account.</p>

    <form onsubmit={submit}>
      {#if needsName}
        <label>
          <span>Your name</span>
          <input class="input" bind:value={name} required autocomplete="name" />
        </label>
      {/if}
      <label class="check">
        <input type="checkbox" bind:checked={confirmAdult} />
        <span>I confirm I am 18 years of age or older.</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={agreeTerms} />
        <span>
          I agree to the <a href="/legal/terms" target="_blank" rel="noopener">Terms of Service</a>
          and <a href="/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
        </span>
      </label>

      {#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}

      <button class="btn" type="submit" disabled={busy || !canSubmit}>
        {busy ? 'Please wait…' : 'Continue'}
      </button>
    </form>
  </div>
</div>

<style>
  .auth {
    max-width: 440px;
    margin: 64px auto;
  }
  .auth .card {
    border-radius: var(--radius-lg);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 20px;
  }
  label:not(.check) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label:not(.check) span {
    font-size: 13px;
    color: var(--text-dim);
  }
  .check {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 9px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .check input {
    margin-top: 2px;
    flex: 0 0 auto;
  }
</style>
