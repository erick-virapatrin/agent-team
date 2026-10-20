# Guide de migration DSH pour le plugin Agent Team

Guide opérationnel issu de la migration **0.1.1-rc.2 → 0.2.0-rc.2** (PR #12, branche
`fix/dsh-020-compat`, SHA `64518c4`). Toutes les commandes de ce guide ont été exécutées pendant
cette migration ; la colonne *Résultat attendu* est l'observation réelle.
Analyse des coûts : [DSH-MIGRATION-RETRO.md](DSH-MIGRATION-RETRO.md).
Brief réutilisable : [DSH-MIGRATION-TASKBRIEF.md](DSH-MIGRATION-TASKBRIEF.md).
Veille des versions : [DSH-UPGRADE-WATCH.md](DSH-UPGRADE-WATCH.md).

Outils livrés (sans dépendance, lecture seule) :
- [tooling/dsh-api-surface.mjs](tooling/dsh-api-surface.mjs) — inventaire de surface d'API (symboles importés + services injectés).
- [tooling/dsh-session-metrics.mjs](tooling/dsh-session-metrics.mjs) — métriques d'exécution à partir des journaux de session.

## 0. Règles de base (coûteuses à apprendre par cœur)

1. **La source de vérité est l'arbre de paquets installé**, jamais la documentation ni la mémoire :
   `$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/*` pour le runtime,
   `node_modules/@deepseek-ai/*` pour le plugin.
2. **Le typecheck n'est pas une preuve d'exécution.** Les incompatibilités visibles uniquement au
   chargement/à l'exécution (waterfalls cordis, frames, signatures de callbacks DI, champs de DTO)
   ne sont détectées que par la phase 6.
3. **Aucun `npm` pipé** : une commande de gate s'exécute sans `| tail`/`| head`, avec le cache dans
   le workspace : `npm --cache .scratch/npm-cache …`. Le sandbox rend le cache npm global et `~/.dsh`
   non inscriptibles.
4. **Le gate du plugin est sémantique** : le runtime vérifie `semver.satisfies(runtimeVersion, peerRange)`
   pour **chaque** peer `@deepseek-ai/dsh*` avec `includePrerelease: true`
   (`@deepseek-ai/dsh-app-boot/lib/index.js`, fonction d'évaluation de compatibilité). Un seul peer
   mal aligné = plugin non chargé.
5. **Les doubles de test reproduisent les signatures du `.d.ts` installé** (règle n° 1 de la phase 5).

## 1. Préflight (≈ 10 minutes, tout déterministe)

| # | Commande | Résultat attendu |
| --- | --- | --- |
| 1.1 | `node -v && npm -v` | Node ≥ 22 (ici 26.11.1), npm ≥ 10 |
| 1.2 | `node -e "console.log(require('@deepseek-ai/dsh/package.json').version)"` (dans l'arbre global) | version runtime cible, ex. `0.2.0-rc.2` |
| 1.3 | `npm view @deepseek-ai/dsh dist-tags --json` | `latest`/`next` → version cible confirmée |
| 1.4 | `node -e "console.log(JSON.stringify(require('./package.json').peerDependencies,null,1))"` | liste des peers à aligner (tous `@deepseek-ai/dsh*` + `cordis`) |
| 1.5 | `mkdir -p .scratch && npm --cache .scratch/npm-cache ci` | `EXIT=0` ; **un échec ici = problème d'environnement, pas de code** |
| 1.6 | `npm run check` | baseline **verte sur la version courante** ; si elle échoue, réparer avant toute migration |
| 1.7 | `ls ~/.dsh/profiles` | périmètre d'écriture hors workspace → **prévoir les approbations** |
| 1.8 | `dsh --help` puis `dsh plugin --help` | vérifier la **forme des arguments** (profil en positionnel, pas `--profile` partout) |

Pièges observés et leur signal :
- `EROFS: read-only file system … npm-cache` → utiliser `--cache .scratch/npm-cache`.
- `option '--profile <name>' argument 'x' is invalid. select a profile only once` → le nom de profil
  se passe en **argument positionnel** : `dsh <profil> …`, `dsh plugin --profile <profil> …`
  (seul `dsh plugin` accepte `--profile`).
- `Current DSH file policy: workspace-write` → toute écriture dans `~/.dsh` demande une approbation.

## 2. Analyse d'écarts avant la première ligne modifiée

### 2.1 Sonde de surface d'API (1 appel d'outil, 66 symboles / 14 services mesurés en 2 s)

```bash
node -e "/* extraire les importations du plugin */"   # voir §2.1 ci-dessous
node docs/engineering/tooling/dsh-api-surface.mjs \
  --imports .scratch/plugin-imports.json \
  --services .scratch/plugin-services.json \
  --base node_modules/@deepseek-ai \
  --target "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
```

Extraction des deux fichiers d'entrée (à coller dans `.scratch/`) :

```bash
# plugin-imports.json : { "paquet[:sous-chemin]": ["Symbole", …] }
node -e "const fs=require('fs'),p=require('path');const files=[];
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);
if(e.isDirectory())w(f);else if(/\.tsx?$/.test(e.name))files.push(f)}})('src');
const m=new Map();for(const f of files){const t=fs.readFileSync(f,'utf8');
for(const x of t.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)){
if(!x[2].startsWith('@deepseek-ai/'))continue;const k=x[2].split('/').slice(0,2).join('/');
const s=m.get(k)??new Set();m.set(k,s);for(const r of x[1].split(',')){const n=r.trim().split(/\s+as\s+/)[0];if(n)s.add(n)}}}
fs.writeFileSync('.scratch/plugin-imports.json',JSON.stringify(Object.fromEntries([...m].sort().map(([k,v])=>[k,[...v]])),null,1))"

# plugin-services.json : liste des services injectés (src/index.ts)
node -e "const fs=require('fs');const s=fs.readFileSync('src/index.ts','utf8');
const m=s.match(/export const inject = \[([\s\S]*?)\]/);
fs.writeFileSync('.scratch/plugin-services.json',JSON.stringify([...(m?m[1]:'').matchAll(/'([^']+)'/g)].map(x=>x[1]),null,1))"
```

Sortie : `summary.missingInTarget` = symboles supprimés/renomités, `summary.signatureChanged`
= déclarations dont le texte a changé, `servicesMissingInTarget` = services disparus.
**C'est la liste de travail de la migration.**

### 2.2 Recensement d'erreurs de compilation (ground truth du port)

```bash
npx tsc --noEmit > .scratch/tc-baseline.txt 2>&1; echo "EXIT=$?"
grep -c "error TS" .scratch/tc-baseline.txt
grep -o "error TS[0-9]*" .scratch/tc-baseline.txt | sort | uniq -c | sort -rn
```

Migrer `package.json` (peers + deps + `@types/node` alignés sur le runtime) **avant** le premier
`npx tsc` de port : c'est ce qui a produit la liste exacte (116 erreurs) en un seul appel.

### 2.3 Lectures ciblées du `.d.ts` installé (à faire une fois, pas dix)

```bash
grep -rn "@deprecated" node_modules/@deepseek-ai/*/lib/types/*.d.ts | head -30
grep -rn "\.on('" node_modules/@deepseek-ai/*/lib/index.js | head -40     # événements cordis disponibles
grep -rn "@waterfall" node_modules/@deepseek-ai/*/lib/types/*.d.ts | head -30
```

Fichiers à lire en entier (les plus impactés par l'observation) :
`dsh-session/lib/types/index.d.ts` (lecture d'événements, `session/event`),
`dsh-session-persistence/lib/types/index.d.ts` (`open`/`read`/`close`, `header`),
`dsh-agent/lib/types/index.d.ts` (`AgentSetup`, frames, `acquireScope`),
`dsh-llm/lib/types/index.d.ts` (`assistant/message.stream` + `usage`),
`dsh-client-ui-primitives` (exports UI), `dsh-workspace/lib/types/index.d.ts` (ids, `directoryPicker`).

## 3. Ordre de migration (validé par la découpe des commits)

| Étape | Contenu | Pourquoi cet ordre |
| --- | --- | --- |
| 1 | `package.json` + `package-lock.json` (peers, deps, `@types/node`, `tsconfig` si `using declare` requis) | fixe la surface réelle ; le typecheck devient lisible |
| 2 | `src/domain/` (types partagés sans API DSH) | crée les constantes de nouveau comportement (ex. source de message) sans casser le reste |
| 3 | `src/runtime/` (session, projecteur, pont, builders) | couche qui touche le plus d'API disparues |
| 4 | `src/service/` + `src/transport/` (contrats, endpoints) | exposes le nouveau comportement au client |
| 5 | `src/client/` (composants, slots, icônes) | 53 renommages d'icônes ici : traitement par lot scripté, pas manuel |
| 6 | `tests/` (mocks conformes aux signatures installées) | révèle les faux positifs des étapes 3-5 |
| 7 | vérification runtime (phase 6) | seule preuve d'exécution |

Boucle par couche : `npx tsc --noEmit` **non pipé**, fichier par fichier ; un seul point d'erreur
à la fois. Observé : 22 exécutions pour la couche runtime, 14 minutes.

## 4. Tables de correspondance 0.1.1-rc.2 → 0.2.0-rc.2 (vérifiées à la compilation)

| 0.1.1 | 0.2.0 | Note |
| --- | --- | --- |
| `apiProxy` / `MuxFrame` (`dsh-cordis-client-api-proxy`) | waterfall cordis `approval/request`, `user-questions/request` | paquet disparu ; pont à réécrire |
| `session.events` | `session.snapshotEvents(from?, toExclusive?)` | **`@deprecated`** : migration cible = `session/event` + `open/read` |
| `sessionPersistence.inspect(id)` / `.list()` | `open(id,'read')` → `read(0)` → `close()` ; `.header` | handle de lecture asynchrone |
| `Context.agent` (1 arg) | `AgentSetup = (agentCtx, agent)` | DI 2 arguments ; les mocks à 1 argument cassent à l'exécution |
| `standingKeyFor(...)` | `acquireScope(id?)` + `Symbol.asyncDispose` | nécessite `"lib": ["…, ESNext.Disposable"]` |
| `tool-result` block / source de message | `ToolResultMessage`, `MessageSource` (`kind: 'agent-team'`) | source typée côté `dsh-llm` |
| `assistant/chunk` | enregistrement durable `assistant/message.stream` + `usage`, frames cordis `agent/assistant-stream` | streaming = prouvé à l'exécution, pas au typecheck |
| `workspaces.pickDirectory()` | `directoryPicker.capability()` → plugin `workspace.pick` | capability de serveur d'hôtes |
| icônes `Icon<X>` | `Icon<X>Regular` / `Icon<X>OutlineRegular` | 53 sites traités par lot |
| `MarkdownText` | idem + prop `labels` obligatoire | constantes de libellés centralisées |
| `Modal` headless | sans `closeLabel` (union de types) | ne pas passer `closeLabel` en mode headless |
| texte utilisateur brut | `projectUserText` | affichage des messages utilisateur |

## 5. Règles de tests (le point le plus coûteux de la migration)

1. **Chaque double de test reproduit la signature installée.** Conséquence observée : 5 tests en
   échec en cascade (`deliveryState: 'queued'`) parce que les fausses sessions n'avaient pas
   `snapshotEvents`, et un `TypeError` runtime (`assistant-builder-runtime.ts:406`) parce que le
   mock `setup` acceptait 1 argument.
2. Tester le **nouveau** comportement, pas l'ancien : persistance des frames, projection depuis des
   événements persistés, arrêt en cours de tour, source de message relayée.
3. Un mock incomplet doit être **refusé par le typecheck** : typer les doubles avec l'interface
   réelle (`satisfies Agent`, `satisfies Session`) au lieu de les écrire à la main en objet littéral.
4. Gates : `npm run check` = `guard:architecture` + `typecheck` + `vitest run` + `build`.
   Référence observée : 20 fichiers / 114 tests / bundles `lib/index.js` 184 kB, `lib/client.js` 323 kB.

## 6. Vérification finale — preuve d'exécution (obligatoire)

Aucun de ces points n'est couvert par `npm run check`. Temps observé de cette phase : **2 h 20**
(à compresser avec le script de profil de test du §6.6).

### 6.1 Chargement du plugin (gate de compatibilité)

```bash
dsh agent-team-compat --from-default-profile web          # crée le profil de test (écrit dans ~/.dsh)
dsh plugin --profile agent-team-compat add link:/ABS/PATH/agent-team
dsh agent-team-compat --dump-config | grep -n -A 4 "agent-team"
```
Résultat attendu : le plugin apparaît (`- id: agent-team`). Une entrée absente ou un avertissement
de version = **peer non satisfait** → corriger les `peerDependencies`, pas le code.

### 6.2 Démarrage et enregistrement du client

```bash
dsh agent-team-compat --no-open --port 3099 > .scratch/server.log 2>&1 &
grep -n "agent-team" .scratch/server.log | head
```
Résultat attendu : le serveur démarre et enregistre l'entrée de navigation « Agent Team ».

### 6.3 Sondes d'API réelles (équipe, messages, reprise)

```bash
curl -s -X POST http://127.0.0.1:3099/agent-team/api \
  -H 'content-type: application/json' \
  -d '{"requestId":"p1","method":"catalog","payload":{}}'
```
Format exact du corps : `{ requestId, method, payload }`. Les méthodes preneuses d'identifiant
attendent `{ id }` — **pas** `{ teamId }` (erreur observée : `Unrecognized key(s) in object: 'teamId'`).
Champs de DTO à lire dans `src/transport/contracts.ts` avant d'écrire une sonde :
l'objet travail est `workbench.conversations`, **pas** `workbench.members`.

Sondes à passer, avec résultat observé :
- `team.create` (2 membres, presets modèles) puis `team.start` → `activeMembers: 2`,
  `deliveryState: 'delivered'`.
- `assistant.list` → assistants avec `sessionIds` ; vérifier `lastActiveAt` **après** un message.
- relance du serveur → projection des sessions **persistées** (reprise à froid) ; le transcript se
  reconstruit depuis le log, pas depuis l'état mémoire.
- messages inter-agents : le nœud utilisateur relayé n'apparaît qu'**après** consommation du tour
  (`agent/inbox/spliced` non projeté) — comportement à vérifier, pas à supposer.
- permissions : preset de profil ; un preset `minimal` peut déclencher
  `PRESET_PROMPT_INCOMPATIBLE: Preset 'minimal' replaced Agent Team prompt sections`.

### 6.4 Streaming sans clé de modèle (stub local)

Ajouter une route OpenAI compatible dans `~/.dsh/profiles/agent-team-compat/cordis.yml`
(`providerKind: openai-compatible`, `apiKey: PROBE_LLM_KEY`, `baseUrl` sur un port local), démarrer
un stub SSE (script de la mission : `.scratch/stub-llm.mjs`, réponse en 4 chunks, `stream: true`),
créer un assistant sur cette route, envoyer un message, scruter `GET /api/sessions/<id>` :

Résultat observé et attendu : nœud live croissant caractère par caractère (5 → 49 caractères,
polling 150 ms), puis remplacement par le nœud durable ; dans le log persisté, `text-chunks`
espacés de ~250 ms ; `contextUsage` = 137 entrée / 1 sortie / 40 cache-lu, fenêtre 32000.

Sans stub, le premier tour réel a produit un nœud `notice` (`no API key for provider route …`) :
**vérifier la disponibilité d'un fournisseur en préflight**.

### 6.5 Inspection des journaux de session (preuve durable)

```bash
node -e "const z=require('zlib'),fs=require('fs');
console.log(z.zstdDecompressSync(fs.readFileSync(process.env.HOME+
'/.dsh/sessions/<slug-cwd>/<session>/session.v4.jsonl.zstd')).toString('utf8'))" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const l of s.trim().split('\n')){
const e=JSON.parse(l);if(e.type==='assistant/message')console.log(e.data.usage)}})"
```
Un événement `request/header` + `usage` = tour de modèle réel consommé (137 jetons d'entrée dans
la sonde). `toolWallTime`/gaps : [tooling/dsh-session-metrics.mjs](tooling/dsh-session-metrics.mjs).

### 6.6 Script de profil de test (à automatiser)

Les 5 commandes de §6.1-6.2 + le stub de §6.4 + les 4 sondes de §6.3 doivent tenir dans un script
idempotent `docs/engineering/tooling/dsh-plugin-runtime-check.sh` (création de profil si absent,
`plugin add link:`, `--dump-config` comme assertion, serveur en arrière-plan avec port libre,
sondes avec assertions, arrêt propre, suppression du profil en sortie). Gain attendu : la phase
d'intégration de 2 h 20 avec 11 approbations doit tenir en < 45 min avec < 4 approbations.

## 7. Rollback

1. `git checkout main && git branch -D fix/dsh-020-compat` (branche de port non fusionnée) ;
   le dépôt de référence (`upstream`) n'est jamais touché.
2. `git checkout <sha-0.1.4> -- package.json package-lock.json && npm --cache .scratch/npm-cache ci`
   pour rendre l'arbre 0.1.1 fonctionnel.
3. Profil de test : ne pas réutiliser un profil ayant chargé le plugin 0.2.0 ; le recréer
   (`rm -rf ~/.dsh/profiles/<nom>` puis `--from-default-profile`) pour écarter tout artefact
   de `cordis.patch.yml`.
4. Le plugin est un `link:` : aucun état serveur à purger ; les sessions créées par les sondes
   restent dans `~/.dsh/sessions/` (les nommer `probe-*` pour les repérer).

## 8. Erreurs typiques observées et remède

| Signature d'erreur | Cause | Remède |
| --- | --- | --- |
| `option '--profile <name>' argument '…' is invalid. select a profile only once` | forme CLI | profil en positionnel (`dsh <profil> …`) |
| `EROFS: read-only file system, open '…/profiles/<p>/cordis.yml'` | sandbox | approbation explicite pour `~/.dsh/profiles/<p>` |
| `npm ERR` + cache en lecture seule | sandbox | `--cache .scratch/npm-cache`, **sans pipe** |
| `Unrecognized key(s) in object: 'teamId'` + `expected: 'string', path: [Array]` | DTO | envoyer `{ id }` ; relire `src/transport/contracts.ts` |
| `TypeError: Cannot read properties of undefined (reading 'map')` | DTO lu de mémoire | `workbench.conversations` |
| `Cannot read properties of undefined (reading 'id')` sur un handle persisté | API 0.2.0 | `handle.header.id` (plus `snapshot.header`) |
| `this.ctx.<service>.acquireScope is not a function` | API 0.2.0 | `acquireScope(id?)` + `Symbol.asyncDispose` |
| `ctx.slots` / `ctx.workspaces` : `TS2339 Property '…' does not exist` | augmentations | importer `Context` depuis `@deepseek-ai/dsh-client-connection` |
| `MessageText: TS2304 Cannot find name` | import manquant | importer depuis `dsh-llm` |
| tests en échec `deliveryState: 'queued'` | mock de session sans `snapshotEvents` | mocks conformes au `.d.ts` |
| `TypeError … reading 'session'` (`assistant-builder-runtime.ts`) | `setup` mocké à 1 argument | `setup(agentCtx, agent)` dans les doubles |
| `expect(object).toContain` avec `streaming: undefined` | sémantique vitest | tester la clé absente (`not.toHaveProperty`) |
| `Modal` refusant `closeLabel` | union headless | omettre `closeLabel` en mode headless |
| `PRESET_PROMPT_INCOMPATIBLE: Preset 'minimal' replaced Agent Team prompt sections` | preset incompatible | preset compatible Agent Team (voir docs plugin) |
