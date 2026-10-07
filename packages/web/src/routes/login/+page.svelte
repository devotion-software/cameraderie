<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { signIn, signUp, useSession } from '$lib/auth';

  const session = useSession();
  const redirectTo = $derived(page.url.searchParams.get('redirect') || '/groups');
  let mode: 'signin' | 'signup' = $state('signin');
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  $effect(() => {
    if ($session.data?.user) goto(redirectTo, { replaceState: true });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const res =
        mode === 'signin'
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name });
      if (res.error) {
        error = res.error.message ?? 'Something went wrong';
      } else {
        goto(redirectTo);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }
</script>

<div class="auth">
  <div class="card">
    <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
    <p class="muted">Private groups for full-fidelity photos and videos.</p>

    <form onsubmit={submit}>
      {#if mode === 'signup'}
        <label>
          <span>Name</span>
          <input class="input" bind:value={name} required autocomplete="name" />
        </label>
      {/if}
      <label>
        <span>Email</span>
        <input class="input" type="email" bind:value={email} required autocomplete="email" />
      </label>
      <label>
        <span>Password</span>
        <input
          class="input"
          type="password"
          bind:value={password}
          required
          minlength={8}
          autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />
      </label>

      {#if error}<p class="error">{error}</p>{/if}

      <button class="btn" type="submit" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
      </button>
    </form>

    <p class="switch muted">
      {#if mode === 'signin'}
        No account?
        <button class="btn ghost" onclick={() => (mode = 'signup')}>Sign up</button>
      {:else}
        Already have one?
        <button class="btn ghost" onclick={() => (mode = 'signin')}>Sign in</button>
      {/if}
    </p>
  </div>
</div>

<style>
  .auth {
    max-width: 400px;
    margin: 48px auto;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 20px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label span {
    font-size: 13px;
    color: var(--text-dim);
  }
  .switch {
    margin-top: 16px;
    text-align: center;
    font-size: 14px;
  }
</style>
