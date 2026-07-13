import type { Metadata } from "next"
import Link from "next/link"
import type * as React from "react"

import { appRoutes } from "../_constants/routes"
import { LegalPage, type LegalSection } from "../_components/legal-page"

export const metadata: Metadata = {
  title: "Terms & Conditions — Stellar Shield",
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
    heading: "Acceptance of Terms",
    body: (
      <>
        <p>
          By accessing or using the Stellar Shield application, dashboard,
          contracts, or related tools (together, the &ldquo;Service&rdquo;), you
          agree to these Terms. If you do not agree, do not use the Service.
        </p>
        <p>
          These Terms may change (see <em>Changes to These Terms</em>).
          Continued use after a change means you accept the updated Terms.
        </p>
      </>
    ),
  },
  {
    heading: "What Stellar Shield Is",
    body: (
      <>
        <p>
          Stellar Shield is a privacy-preserving (&ldquo;shielded&rdquo;)
          lending pool deployed on <strong>Stellar testnet</strong>, together
          with a browser dashboard.
        </p>
        <p>
          It is a <strong>testnet technical validation</strong>, not a live
          financial product. As of this writing it has zero users, zero total
          value locked, no revenue, and no token. All assets are funded through
          friendbot and have <strong>no real monetary value</strong>. Nothing in
          the Service is an offer of a security, a financial instrument, or a
          real asset. Everything is experimental and subject to change or
          removal without notice.
        </p>
      </>
    ),
  },
  {
    heading: "Eligibility & Prohibited Uses",
    body: (
      <>
        <p>
          You may use the Service only if you can form a binding agreement under
          the laws that apply to you, and only where such use is lawful. You must
          not use the Service:
        </p>
        <ul>
          <li>for any unlawful activity, or to facilitate one;</li>
          <li>
            if you are a person, or acting on behalf of a person, subject to
            sanctions, or if you are located in a sanctioned or embargoed
            jurisdiction [PLACEHOLDER: sanctions regimes and restricted
            jurisdictions — to be set by counsel];
          </li>
          <li>
            for money laundering, terrorist financing, or the movement of
            proceeds of crime;
          </li>
          <li>
            to evade any legal, regulatory, or reporting obligation that applies
            to you.
          </li>
        </ul>
        <p>
          The legal status of privacy-preserving protocols is unsettled. In
          2025, in <em>United States v. Roman Storm</em>, a Tornado Cash
          developer was convicted of operating an unlicensed money-transmitting
          business. You are solely responsible for determining whether your use
          of the Service is lawful where you are.
        </p>
      </>
    ),
  },
  {
    heading: "Non-Custodial Service",
    body: (
      <>
        <p>
          The Service is <strong>non-custodial</strong>. It never takes custody
          of your funds or your keys. Your shielded identity — the spend key and
          memo-decryption key — is derived in your browser from a signature made
          with your Freighter wallet, and is cached in your browser&rsquo;s local
          storage. Zero-knowledge proofs are generated in your browser. No server
          operated for the Service stores your keys, your funds, or your position
          data.
        </p>
        <p>
          You are solely responsible for your wallet, your keys, your local
          storage, and your encrypted backup file. If you lose them, the Service
          cannot recover them for you, and neither can anyone else.
        </p>
      </>
    ),
  },
  {
    heading: "Assumption of Risk",
    body: (
      <>
        <p>
          You use the Service at your own risk and assume full responsibility
          for that risk, including:
        </p>
        <ul>
          <li>
            <strong>Total loss.</strong> Test assets have no value, but the same
            design applied to real assets could result in complete and permanent
            loss.
          </li>
          <li>
            <strong>Smart-contract risk.</strong> The contracts are unaudited and
            written by a single developer. They may contain errors, and errors
            may be irreversible.
          </li>
          <li>
            <strong>Cryptographic risk.</strong> The circuits use a development,
            single-contributor trusted setup. Because the setup is not a
            multi-party ceremony, proofs are theoretically forgeable by anyone
            holding the setup&rsquo;s secret.
          </li>
          <li>
            <strong>Oracle risk.</strong> Prices come from a single Reflector
            oracle and are not cross-checked on-chain. A wrong or manipulated
            price can produce wrong outcomes, including unjustified liquidations.
          </li>
          <li>
            <strong>Admin-key risk.</strong> A single admin key can upgrade the
            contract. Whoever holds it can change how the Service behaves.
          </li>
          <li>
            <strong>Testnet risk.</strong> Testnet may be reset, halted, or
            changed at any time. Your test state may disappear.
          </li>
          <li>
            <strong>Recovery risk.</strong> Your note inventory is rebuilt from
            public chain events, but recovery from events is bounded to roughly a
            14-hour RPC retention window. Beyond that window, your encrypted local
            backup is the only recovery path. Lose both, and your notes may be
            permanently unrecoverable.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "No Privacy or Security Guarantee",
    body: (
      <>
        <p>
          The Service does <strong>not</strong> guarantee privacy or security. In
          particular, at current testnet volume the anonymity set is effectively
          zero, so your activity can be correlated by a passive observer despite
          the underlying cryptography working as designed.
        </p>
        <p>
          Read the{" "}
          <Link href={appRoutes.privacySecurity}>
            Privacy &amp; Security
          </Link>{" "}
          page in full before relying on any privacy property. Do not assume your
          positions are private.
        </p>
      </>
    ),
  },
  {
    heading: "No Warranty",
    body: (
      <>
        <p>
          The Service is provided <strong>&ldquo;as is&rdquo;</strong> and{" "}
          <strong>&ldquo;as available,&rdquo;</strong> without warranty of any
          kind, express or implied, including any implied warranties of
          merchantability, fitness for a particular purpose, title, or
          non-infringement.
        </p>
        <p>
          We do not warrant that the Service will be uninterrupted, error-free,
          secure, or that any defect will be corrected.
        </p>
      </>
    ),
  },
  {
    heading: "Limitation of Liability",
    body: (
      <>
        <p>
          To the fullest extent permitted by law, the Service&rsquo;s authors and
          contributors are <strong>not liable</strong> for any indirect,
          incidental, special, consequential, or punitive damages, or for any
          loss of funds, data, keys, notes, or profits, arising out of or
          relating to your use of the Service — whether or not such loss was
          foreseeable and whether based in contract, tort, or any other theory.
        </p>
        <p>
          [PLACEHOLDER: aggregate liability cap and any jurisdiction-specific
          carve-outs — to be set by counsel.]
        </p>
      </>
    ),
  },
  {
    heading: "Not Financial, Investment, or Legal Advice",
    body: (
      <p>
        Nothing in the Service is financial, investment, tax, or legal advice.
        Nothing here is a recommendation to enter into any transaction. You are
        solely responsible for your own decisions, your own regulatory
        compliance, and your own taxes.
      </p>
    ),
  },
  {
    heading: "Intellectual Property & Open Source",
    body: (
      <>
        <p>
          [PLACEHOLDER: open-source license(s) and repository URL — to be
          confirmed.] Except as stated in the applicable open-source license, all
          rights are reserved. Third-party components remain governed by their own
          licenses. See the{" "}
          <Link href={appRoutes.docs}>project documentation</Link> for details.
        </p>
        <p>
          The names, logos, and branding associated with the Service may not be
          used in a way that implies endorsement without permission.
        </p>
      </>
    ),
  },
  {
    heading: "Changes to These Terms",
    body: (
      <p>
        We may update these Terms at any time. When we do, we will update the
        date at the top of this page. Material changes take effect when posted.
        It is your responsibility to review the Terms periodically.
      </p>
    ),
  },
  {
    heading: "Governing Law",
    body: (
      <p>
        These Terms are governed by, and construed under, the laws of
        [PLACEHOLDER: governing jurisdiction — to be set by counsel], without
        regard to conflict-of-laws rules. Any dispute is subject to [PLACEHOLDER:
        dispute resolution / venue — to be set by counsel].
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions about these Terms: [PLACEHOLDER: contact email or channel — to
        be confirmed].
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

export default function TermsPage(): React.ReactElement {
  return (
    <LegalPage
      intro={intro}
      lastUpdated={lastUpdated}
      sections={sections}
      title="Terms & Conditions"
    />
  )
}
