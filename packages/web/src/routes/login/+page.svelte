<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient, signIn, useSession } from '$lib/auth';
  import { slide } from 'svelte/transition';

  const session = useSession();
  const redirectTo = $derived(page.url.searchParams.get('redirect') || '/groups');

  let step: 'email' | 'otp' | 'passkey-prompt' = $state('email');
  let email = $state('');
  let otp = $state('');
  let error = $state('');
  let busy = $state(false);
  // Suppresses the auto-redirect-on-session effect below while we're offering
  // to set up a passkey right after an email-OTP sign-in.
  let offeringPasskey = $state(false);

  $effect(() => {
    if ($session.data?.user && !offeringPasskey) goto(redirectTo, { replaceState: true });
  });

  async function sendCode(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
      if (res.error) {
        error = res.error.message ?? 'Something went wrong';
      } else {
        step = 'otp';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }

  async function verifyCode(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const res = await authClient.signIn.emailOtp({ email, otp });
      if (res.error) {
        error = res.error.message ?? 'Invalid or expired code';
      } else {
        const existing = await authClient
          .$fetch<{ id: string }[]>('/passkey/list-user-passkeys')
          .catch(() => null);
        if (existing && !existing.error && existing.data?.length === 0) {
          offeringPasskey = true;
          step = 'passkey-prompt';
        } else {
          goto(redirectTo);
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }

  async function addPasskeyNow() {
    busy = true;
    error = '';
    try {
      await authClient.passkey.addPasskey();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to add passkey';
    } finally {
      busy = false;
      offeringPasskey = false;
      goto(redirectTo);
    }
  }

  function skipPasskey() {
    offeringPasskey = false;
    goto(redirectTo);
  }

  async function withSocial(provider: 'google' | 'apple') {
    error = '';
    busy = true;
    try {
      const res = await signIn.social({ provider, callbackURL: redirectTo });
      if (res.error) error = res.error.message ?? 'Something went wrong';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }

  async function withPasskey() {
    error = '';
    busy = true;
    try {
      const res = await signIn.passkey();
      if (res?.error) error = res.error.message ?? 'Passkey sign-in failed';
      else goto(redirectTo);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }
</script>

<div class="auth">
  <div class="card">
    <p class="eyebrow">Cameraderie</p>
    <h1>Welcome</h1>
    <p class="muted">Private groups for full-fidelity photos and videos.</p>
    <p class="muted small invite-note">
      Cameraderie is invite only right now. If you know someone who's already signed up, you can
      ask them to invite you to a group.
    </p>

    {#if step === 'email'}
      <div class="social" transition:slide={{ duration: 180 }}>
        <button class="btn secondary" type="button" disabled={busy} onclick={() => withSocial('google')}>
          <svg class="provider-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.1z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.5 0 10.4-1.9 14.1-5l-6.5-5.4C29.6 35.4 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.1 39.6 15.9 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.5 5.4C39.9 37.3 44 31.4 44 24c0-1.3-.1-2.7-.4-3.5z"
            />
          </svg>
          Continue with Google
        </button>
        <button class="btn secondary" type="button" disabled={busy} onclick={() => withSocial('apple')}>
          <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path
              d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
            />
          </svg>
          Continue with Apple
        </button>
        <button class="btn secondary" type="button" disabled={busy} onclick={withPasskey}>
          Continue with a passkey
        </button>
      </div>

      <div class="divider" transition:slide={{ duration: 180 }}><span>or</span></div>

      <form onsubmit={sendCode}>
        <label>
          <span>Email</span>
          <input class="input" type="email" bind:value={email} required autocomplete="email" />
        </label>
        {#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}
        <button class="btn" type="submit" disabled={busy || !email}>
          {busy ? 'Please wait…' : 'Send sign-in code'}
        </button>
      </form>
    {:else if step === 'otp'}
      <form onsubmit={verifyCode}>
        <p class="muted small">
          We sent a code to <strong>{email}</strong>. It expires in 5 minutes.
        </p>
        <label>
          <span>Code</span>
          <input
            class="input"
            bind:value={otp}
            required
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength={6}
          />
        </label>
        {#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}
        <button class="btn" type="submit" disabled={busy || otp.length < 6}>
          {busy ? 'Please wait…' : 'Continue'}
        </button>
        <button
          class="btn ghost"
          type="button"
          disabled={busy}
          onclick={() => {
            step = 'email';
            otp = '';
            error = '';
          }}
        >
          Use a different email
        </button>
      </form>
    {:else if step === 'passkey-prompt'}
      <div class="passkey-prompt">
        <p class="muted small">
          Add a passkey for faster, more secure sign-in next time &mdash; Face ID, Touch ID, or a
          security key.
        </p>
        {#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}
        <button class="btn" type="button" disabled={busy} onclick={addPasskeyNow}>
          {busy ? 'Follow your browser prompt…' : 'Add a passkey'}
        </button>
        <button class="btn ghost" type="button" disabled={busy} onclick={skipPasskey}>
          Not now
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .auth {
    max-width: 400px;
    margin: 64px auto;
  }
  .auth .card {
    border-radius: var(--radius-lg);
  }
  .social {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
  }
  .social .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .provider-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 18px 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  form,
  .passkey-prompt {
    display: flex;
    flex-direction: column;
    gap: 14px;
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
  .small {
    font-size: 12px;
  }
  .invite-note {
    margin-top: 4px;
  }
</style>
