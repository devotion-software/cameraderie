<script lang="ts">
  // Starter draft — see the banner. Replace bracketed placeholders and have the
  // whole document reviewed by a qualified solicitor before any public launch.
  const LAST_UPDATED = '2026-10-08';
  const OPERATOR = '[OPERATOR LEGAL NAME]';
  const CONTACT = '[contact@your-domain]';
  const GOVERNING_LAW = 'England and Wales';
</script>

<svelte:head><title>Terms of Service — Cameraderie</title></svelte:head>

<article class="legal">
  <div class="draft" role="note">
    ⚠️ <strong>Draft — not yet legally reviewed.</strong> This is starter wording to be checked by a qualified
    solicitor and have its placeholders completed before launch. It is not legal advice.
  </div>

  <h1>Terms of Service</h1>
  <p class="muted">Last updated: {LAST_UPDATED}</p>

  <h2>1. Who we are &amp; acceptance</h2>
  <p>
    Cameraderie (“the Service”) is operated by {OPERATOR} (“we”, “us”). By creating an account or using
    the Service you agree to these Terms. If you do not agree, do not use the Service.
  </p>

  <h2>2. Eligibility (18+)</h2>
  <p>
    The Service is for adults only. You must be <strong>18 years of age or older</strong>
    to create an account, and you confirm this at sign-up. We may suspend accounts we reasonably believe
    belong to under-18s.
  </p>

  <h2>3. Your account</h2>
  <p>
    You are responsible for keeping your login credentials secure and for all activity under your
    account. Access is invite-only; do not share invites with people you would not want to have
    access to your groups’ content.
  </p>

  <h2>4. Your content &amp; licence</h2>
  <p>
    You keep all ownership of the photos and videos you upload (“Your Content”). Originals are
    stored byte-for-byte and are never re-encoded. You grant us a limited, non-exclusive licence to
    store, process (e.g. generate thumbnails and previews) and display Your Content to the members
    of the groups you share it with, solely to operate the Service. We claim no ownership and do not
    use Your Content to train models or for advertising.
  </p>

  <h2>5. Acceptable use &amp; prohibited content</h2>
  <p>You must not upload, store or share content that:</p>
  <ul>
    <li>is unlawful, or that you do not have the rights to;</li>
    <li>
      depicts child sexual abuse (CSAM) — we operate zero tolerance, preserve evidence, and report
      to the relevant authorities (in the UK, the Internet Watch Foundation and the police);
    </li>
    <li>is intended to harass, threaten, or infringe others’ rights.</li>
  </ul>

  <h2>6. Moderation &amp; takedown</h2>
  <p>
    We run automated content-safety checks and accept reports from members. We may remove or
    quarantine content and suspend accounts where these Terms are broken.
  </p>

  <h2>7. Plans, billing &amp; refunds</h2>
  <p>
    Paid storage tiers are billed via Stripe (web) or your app store via RevenueCat (mobile). Prices
    and quotas are shown before purchase. Statutory cancellation and refund rights apply; [describe
    your refund policy].
  </p>

  <h2>8. Termination &amp; deletion</h2>
  <p>
    You can delete your account at any time from Settings; this permanently erases your uploaded
    originals. We may suspend or terminate accounts that breach these Terms.
  </p>

  <h2>9. Disclaimers &amp; liability</h2>
  <p>
    The Service is provided “as is”. To the extent permitted by law we exclude implied warranties
    and limit our liability as set out here [complete with solicitor]. Nothing limits liability that
    cannot be limited by law.
  </p>

  <h2>10. Governing law</h2>
  <p>These Terms are governed by the laws of {GOVERNING_LAW}.</p>

  <h2>11. Changes</h2>
  <p>We may update these Terms; material changes will be notified in-app or by email.</p>

  <h2>12. Contact</h2>
  <p>Questions about these Terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>

  <p class="muted"><a href="/legal/privacy">Privacy Policy →</a></p>
</article>

<style>
  .legal {
    max-width: 720px;
    margin: 24px auto 64px;
    line-height: 1.6;
  }
  .legal h2 {
    margin-top: 28px;
    font-size: 18px;
  }
  .draft {
    border: 1px solid rgba(255, 193, 7, 0.5);
    background: rgba(255, 193, 7, 0.1);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 20px;
    font-size: 14px;
  }
</style>
