# @zpcoder/ember-sdk

Authoritative, deterministic TypeScript rules shared by the Cocos client, local AI, React reference client, and server replay. The package emits ESM JavaScript and declarations; consumers never load raw `.ts` files.

Platform access is dependency-injected through `Clock`, `SecureRng`, `Storage`, and `Network`. Formal PVP state remains server-authoritative; the client SDK only transports commands and stores short-lived sessions.

The migrated legacy rule corpus is emitted with TypeScript's `noCheck` transition mode while the independently authored platform boundary is strict-checked. The 235 deterministic rule tests remain the release gate; removing `noCheck` is tracked as a post-split type-hardening task and does not expose raw TypeScript to Cocos.

```sh
npm ci
npm test
npm run pack:check
```

Releases use Changesets CLI `2.29.8` and publish the restricted `@zpcoder/ember-sdk` package to GitHub Packages from the protected `main` workflow. Local verification must use `pack:check`; it never writes to a registry.
