# Code signing

> Researched 2026-11-22 (Microsoft Learn's Artifact Signing pages and SmartScreen page, electron-builder 26's signing code and docs, and
> the certificate sellers' own pages). Prices change: check them when buying. Buying, and proving who you are, are the person's; the build
> step is ready and stays off until the secrets below exist.

## What signing does, and what it doesn't

Windows' SmartScreen warns before an unsigned program from the internet runs. A signature says who made the program and that nobody changed
it since. **It doesn't make the warning go away at once**: SmartScreen gives a publisher a good name over time, "several weeks and hundreds
of clean installs" by Microsoft's own account, and since 2024 even the expensive "EV" certificates no longer skip that. What signing does
at once: the warning names the publisher instead of "Unknown publisher", the reputation that builds up carries over to every later version
signed by the same name, and antivirus programs trust signed programs more. Keep the same name and the same way of signing from the start:
changing it starts the reputation again.

## The options

| Option | Who can get it | Cost | Works in GitHub's build | Notes |
|---|---|---|---|---|
| **Microsoft Artifact Signing** (was Trusted Signing) | Companies in many countries (US, Canada, EU, UK, Australia, Japan and more); **individual developers only in the US and Canada** | From **$9.99 a month** (Basic: 5,000 signatures a month) | **Yes**: the build step below is ready for it | Needs a paid Azure subscription (pay as you go; free and trial ones aren't accepted), and an identity check: for an individual, a government ID through Microsoft's verifier; for a company, 1 to 30 business days. The name on the signature is the validated legal name. Billing starts when the account is made. |
| **A certificate for an individual** (IV) or company (OV), kept in the seller's cloud | Anyone | SSL.com: about **$129 a year** for the certificate, plus its eSigner cloud signing (from about $15 a month); Certum Standard from about €139 | Yes, with a custom signing script (not prepared yet) | Since June 2023 a certificate's key must live in a hardware token or the seller's cloud, never in a file, so a plain certificate file can't simply be added to the build. A USB token (about $250 to $380 more) can't be used by GitHub's build at all. |
| Certum's open-source certificate (about €25) | Open-source developers | | | Meant for open-source projects: not for a paid, closed program. |

**Recommendation:** if you live in the US or Canada, **Artifact Signing** as an individual: cheapest, no hardware, and the build is ready for
it. If you are elsewhere, either set up a company first (then Artifact Signing), or buy an individual certificate with cloud signing
(SSL.com's eSigner is the best documented for automated builds) and ask for the signing script to be written then.

## Other routes (a playtester's notes, 2026-11-25)

The notes agree with the table above (Artifact Signing first, an OV certificate otherwise, no EV, and a warning that lasts until the
reputation builds), and add three things:

- **Sign as early as you can.** An unsigned build starts from nothing with every release; a signed one carries its reputation to the next.
- **The Microsoft Store, as an MSIX package**, is the one route with no warning at all: Microsoft signs the package, and the notes say the
  developer account is free (not checked here). It is more work: the app would be built as MSIX, the Store updates it itself (so Dragon
  Drop's own updater stays off there), and the terminal, the Claude Code install button and the Documents workspace all need trying inside
  MSIX's container. Sending today's `.exe` installer to the Store still needs a certificate of your own. A later addition beside itch.io,
  not instead of signing.
- **SignPath Foundation** signs for free, but only qualifying open-source projects; Dragon Drop has no licence file and is to be sold, so it
  doesn't fit. And never a self-signed certificate.

## Until it's signed

Testers and buyers are told to expect the warning (`SETUP-WINDOWS.md`, `FAQ.md`) and to download only from the release page. From 0.1.14
every release also lists `SHA256SUMS.txt`, the installer's SHA-256 hash, written by the workflow's publish job; put the hash in the release
notes too. Checking a download, in PowerShell: `Get-FileHash .\Dragon-Drop-Setup-<version>.exe` and compare its Hash with the release's.

## Setting up Artifact Signing (the person, once)

1. An Azure account with a **pay-as-you-go** subscription.
2. In the Azure portal, create an **Artifact Signing account** (Basic) in one region, and note its **endpoint** (it depends on the region,
   for example `https://eus.codesigning.azure.net` for East US) and its **account name**.
3. **Identity validation**: Public Trust, as an individual (US or Canada) or an organization. Wait for it to be approved.
4. Create a **certificate profile** (Public Trust) and note its **name**.
5. Create an **app registration** in Microsoft Entra ID with a client secret, and give it the **Artifact Signing Certificate Profile Signer**
   role on the certificate profile. Note its tenant ID, client ID and secret.
6. In the GitHub repository's Settings → Secrets and variables → Actions, add these **repository secrets**:

   | Secret | What it holds |
   |---|---|
   | `SIGN_ENDPOINT` | the account's endpoint (its presence is what switches signing on) |
   | `SIGN_ACCOUNT` | the Artifact Signing account's name |
   | `SIGN_PROFILE` | the certificate profile's name |
   | `SIGN_PUBLISHER` | the name on the certificate, exactly as validated (the legal name) |
   | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | the app registration's |

7. Run the workflow once by hand (Actions → Checks and Windows installer → Run workflow) on a branch and read the "Build the installer" and
   "List what was built" steps: they should say "Signing with Artifact Signing as …" and "Valid" for the program and the installer. Then
   release as usual.

## What the build does with it

`.github/workflows/desktop.yml`, job `windows-installer`:

- Without `SIGN_ENDPOINT` nothing changes: the build is unsigned, as before (pull requests from Dependabot never see the secrets, so they
  stay unsigned too).
- With it, every other secret must be there (the build stops and names the missing one), electron-builder signs the program and the installer
  through Artifact Signing (its `win.azureSignOptions`, passed on the command line; it installs Microsoft's `TrustedSigning` PowerShell module
  itself) and is told to fail if anything ends up unsigned (`forceCodeSigning`), and the "List what was built" step checks that
  `Dragon Drop.exe` and the installer carry a **Valid** signature. The itch copy is made from the signed program, so it is signed too.
- Not tried yet: there is no signing account. The first signed run is the test.

## Things to know

- **Updates stay safe across the change.** Copies installed before signing have no publisher name in their update settings, so they install
  the first signed version without checking a signature. From then on, each installed copy checks that an update is signed by the same
  publisher name (`SIGN_PUBLISHER`) and refuses one that isn't. So never change that name casually.
- Artifact Signing certificates last three days and are renewed by Microsoft; the signature carries a timestamp, so it stays valid after the
  certificate expires.
- Only `.exe` files are signed (electron-builder's default), which is what SmartScreen looks at.
- After the first signed release, scan the installer once on VirusTotal (`SELLING.md`).
