import type { Metadata } from "next"
import Link from "next/link"
import type * as React from "react"

import { appRoutes } from "../_constants/routes"
import { LegalPage, type LegalSection } from "../_components/legal-page"

export const metadata: Metadata = {
  title: "Privacy & Security — Stellar Shield",
}

const lastUpdated = "13 July 2026"

const intro = (
  <p>
    Stellar Shield runs on Stellar <strong>testnet</strong> with
    friendbot-funded test assets that have <strong>no monetary value</strong>.
    It is an experimental technical validation provided &ldquo;as is.&rdquo;
    This document is an honest draft and has <strong>not</strong> been reviewed
    by counsel.
  </p>
)

const sections: LegalSection[] = [
  {
    heading: "Summary",
    body: (
      <>
        <p>
          Stellar Shield is a shielded lending pool on Stellar testnet. It is
          built to be private, but <strong>privacy is not yet delivered</strong>.
        </p>
        <p>
          The cryptography works as designed: keys and proofs stay in your
          browser, and memos are encrypted. But privacy depends on a crowd to
          hide in, and today there is no crowd. At current testnet volume the
          anonymity set is <strong>effectively zero</strong>, so a passive
          observer can link your deposits and withdrawals by their timing and
          amounts. <strong>Do not treat your positions as private.</strong>
        </p>
        <p>
          This page explains what stays on your device, what becomes public and
          permanent on-chain, and the known limits of the current security model.
        </p>
      </>
    ),
  },
  {
    heading: "Data We Do and Do Not Collect",
    body: (
      <>
        <p>
          The Service is non-custodial.{" "}
          <strong>
            No server operated for the Service stores your keys, your funds, or
            your position data.
          </strong>{" "}
          Your note inventory is rebuilt on your device from public chain events;
          it is not held on a server for you.
        </p>
        <p>
          We do collect, in the ordinary technical sense, whatever your browser
          and network necessarily reveal to reach the app and the RPC endpoints
          (for example, IP address at the transport layer). [PLACEHOLDER: confirm
          whether any analytics/cookies are used — assume none until verified.]
        </p>
      </>
    ),
  },
  {
    heading: "Client-Side Keys & Local Storage",
    body: (
      <>
        <p>
          Your shielded identity — a spend key and a memo-decryption key — is
          derived in your browser from a signature made with your Freighter
          wallet. It is cached in your browser&rsquo;s{" "}
          <strong>local storage</strong> and never sent to a server.
        </p>
        <p>
          Zero-knowledge proofs are also generated in your browser. This keeps
          custody of your keys with you. It also means that anyone with access to
          your device, browser profile, or local storage may be able to reach
          your shielded identity. Protect your device accordingly.
        </p>
      </>
    ),
  },
  {
    heading: "What Is Public and Permanent On-Chain",
    body: (
      <>
        <p>
          Some data is written to the public Stellar ledger and{" "}
          <strong>cannot be deleted by anyone, including us</strong>. This
          includes:
        </p>
        <ul>
          <li>note commitments and nullifiers;</li>
          <li>transaction timing;</li>
          <li>
            the wrapping Stellar wallet address that signs and pays for each
            transaction;
          </li>
          <li>
            encrypted memos (the ciphertext is public, even though its contents
            are encrypted);
          </li>
          <li>pool aggregates.</li>
        </ul>
        <p>
          Because the signing/paying wallet address is public, activity can be
          linked to that address even when the shielded contents are not directly
          readable.
        </p>
      </>
    ),
  },
  {
    heading: "The Anonymity-Set Limitation",
    body: (
      <>
        <p>
          Shielded systems hide an individual action inside a large set of
          similar actions. The larger that set, the stronger the privacy. This
          set is called the anonymity set.
        </p>
        <p>
          At current testnet volume the anonymity set is{" "}
          <strong>effectively zero</strong>. With few or no other participants, a
          passive observer can correlate a deposit with a later withdrawal by
          matching timing and amounts — even though the cryptography is
          functioning correctly.
        </p>
        <p>
          Stated plainly:{" "}
          <strong>privacy is not delivered at current volume.</strong> The design
          may provide privacy at scale, but today it does not. Do not rely on
          Stellar Shield to conceal your activity.
        </p>
      </>
    ),
  },
  {
    heading: "Encrypted Memos & Your Backup Responsibility",
    body: (
      <>
        <p>
          The Service uses encrypted memos so that a fresh browser can rebuild
          your note inventory from public chain events alone, using your
          memo-decryption key.
        </p>
        <p>
          This recovery-from-events path is <strong>bounded</strong>. Chain
          events are retained by RPC for only about <strong>14 hours</strong>.
          Beyond that window, event-based recovery is no longer possible.
        </p>
        <p>
          Past that window, your <strong>encrypted local backup file</strong> is
          the <strong>only</strong> recovery path — and that file is{" "}
          <strong>your responsibility</strong>. If you lose your wallet, your
          local storage, and your backup, your notes may be{" "}
          <strong>permanently unrecoverable</strong>. No one — not us, not any
          third party — can restore them for you. Export your backup and store it
          safely.
        </p>
      </>
    ),
  },
  {
    heading: "Security Model & Known Limitations",
    body: (
      <>
        <p>
          We disclose the following limitations honestly. They are real and
          current:
        </p>
        <ul>
          <li>
            <strong>Development trusted setup.</strong> The proving system uses a
            single-contributor, non-ceremony trusted setup. This means proofs are
            theoretically forgeable by anyone holding the setup&rsquo;s secret.
          </li>
          <li>
            <strong>Unverified oracle price.</strong> The oracle price is not
            cross-checked on-chain, so a wrong or manipulated price is not caught
            by the contract.
          </li>
          <li>
            <strong>Single oracle source.</strong> Prices come from a single
            Reflector oracle. If it fails or is manipulated, there is no
            independent fallback.
          </li>
          <li>
            <strong>Single admin key.</strong> One admin key can upgrade the
            contract. Whoever holds it can change the Service&rsquo;s behavior.
          </li>
          <li>
            <strong>Unaudited code.</strong> The code is unaudited and written by
            a single developer. It has not had independent security review.
          </li>
        </ul>
        <p>
          These limitations are acceptable for a testnet validation with no real
          value. They would <strong>not</strong> be acceptable for real funds
          without significant further work.
        </p>
      </>
    ),
  },
  {
    heading: "Your Responsibilities",
    body: (
      <ul>
        <li>
          Protect your wallet, your device, and your browser&rsquo;s local
          storage.
        </li>
        <li>
          Export and safely store your encrypted backup file. It is your only
          recovery path beyond the ~14-hour event window.
        </li>
        <li>
          Do not assume your positions are private (see{" "}
          <em>The Anonymity-Set Limitation</em>).
        </li>
        <li>
          Comply with the law that applies to you, including any reporting and
          tax obligations. Privacy features do not change your legal duties.
        </li>
      </ul>
    ),
  },
  {
    heading: "Cookies & Tracking",
    body: (
      <p>
        [PLACEHOLDER: confirm whether any analytics/cookies are used — assume
        none until verified.] If and when analytics or cookies are introduced,
        this section will describe what is collected, why, and how to opt out.
      </p>
    ),
  },
  {
    heading: "Changes to This Policy",
    body: (
      <p>
        We may update this page at any time. When we do, we will update the date
        at the top. Material changes take effect when posted. Please review this
        page periodically.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions about privacy or security: [PLACEHOLDER: contact email or
        channel — to be confirmed]. Please do not include private keys, backup
        files, or secrets in any message. See also our{" "}
        <Link href={appRoutes.terms}>Terms &amp; Conditions</Link>.
      </p>
    ),
  },
  {
    heading: "",
    body: (
      <p>
        <em>
          This is an honest draft for a testnet project and is not legal advice;
          it has not been reviewed by counsel.
        </em>
      </p>
    ),
  },
]

export default function PrivacySecurityPage(): React.ReactElement {
  return (
    <LegalPage
      intro={intro}
      lastUpdated={lastUpdated}
      sections={sections}
      title="Privacy & Security"
    />
  )
}
