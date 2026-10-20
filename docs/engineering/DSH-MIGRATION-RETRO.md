# Rétrospective de migration DSH 0.1.1-rc.2 → 0.2.0-rc.2 (AGTEAM-COMPAT-001)

Analyse de performance du développement : ce qui a coûté du temps, ce qui était évitable,
ce qui doit être automatisé. Aucune métrique n'est estimée : chaque ligne indique sa source,
et `UNKNOWN` / `NOT_AVAILABLE` est écrit quand la donnée n'existe pas.

## 1. Périmètre mesuré et sources

| Élément | Valeur | Source |
| --- | --- | --- |
| Dépôt / branche | `agent-team`, `fix/dsh-020-compat` base `main` @ `3dfc9c2` | `git log` |
| SHA final vérifié | `64518c4e266ea20d5d1f75d00d6e1ed880ab9782` | `git rev-parse HEAD`, PR #12 `headRefOid` |
| PR | [limuyang2/agent-team#12](https://github.com/limuyang2/agent-team/pull/12), state `OPEN`, `mergedAt: null` | `gh pr view` |
| Session DSH principale | `~/.dsh/sessions/--home-erick-project-agent-team--/session-9ee564b5-ba55-42aa-93f7-353b241ca72e/session.v4.jsonl.zstd` (2 115 événements) | journal de session |
| Sous-agents (4) | `617d9c91-…`, `3b7ccd22-…`, `3e872dda-…`, `9e57429c-…` (mêmes répertoires) | journaux de session |
| Sessions sondes (exclues) | `agent-team:…` (membres d'équipe créés par la sonde) | `ls ~/.dsh/sessions/…` |
| Git | commits, `git diff --numstat 3dfc9c2..HEAD` | dépôt |
| Registry npm | `@deepseek-ai/dsh` versions + dates ; GitHub `gh api compare` | relevés du 2026-10-20 |

Méthode : script `.scratch/collect-metrics.mjs` (copie livrée dans
[tooling/dsh-session-metrics.mjs](tooling/dsh-session-metrics.mjs)) qui décompresse les journaux
v4 (`zstdDecompressSync`) et agrège par fenêtre temporelle. Fenêtre analysée :
`2026-10-20T05:40Z → 10:50Z`, répertoire de sessions du dépôt, exclusion des sessions `agent-team~`.

## 2. Tableau de métriques

| Indicateur | Mesure | Source / note |
| --- | --- | --- |
| **Durée totale de la mission** | **5 h 04 min 10 s** (05:46:12 → 10:50:22 UTC) | prompts `user/message` seq 8 et 2099 |
| dont pause humaine (« pause les devs » → « tu peux continuer ») | 2 h 02 min 57 s (06:27:19 → 08:30:19) | seq 809 / 840 |
| **Temps actif** (mission − pause) | **3 h 01 min 13 s** | calcul |
| **Temps jusqu'au premier correctif** (1re édition dans `src/`) | **40 min 42 s** (06:26:54) | jalon du collecteur |
| **Temps jusqu'au premier build vert sur la cible** (1er `npm run check` vert après installation 0.2.0) | **2 h 57 min 22 s** de mur ; **57 min 15 s** actif (08:43:34) | signature `npm run check` |
| **Temps jusqu'à la validation finale** (PR créée) | **4 h 54 min 25 s** de mur ; ~2 h 51 min actif (10:40:37) | `gh pr create` |
| **Nombre d'appels LLM** | **591** (session principale 379 + 4 sous-agents 212) | événements `assistant/message` |
| **Tokens entrée** | **1 957 144** | somme `data.usage.inputTokens` |
| **Tokens sortie** | **295 137** | somme `data.usage.outputTokens` |
| **Tokens cache (lecture)** | **44 963 491** | somme `usage.cacheReadTokens` |
| Tokens cache (écriture) | 0 | idem |
| **Coût API** | **UNKNOWN** — aucun prix n'est journalisé par le harness ; les totaux de tokens ci-dessus sont la base de calcul | absence vérifiée dans les événements |
| **Appels outils (total 726)** | bash **603**, read **72**, write **14**, job_output **11**, edit **8**, job_kill **5**, send_message **4**, subagent **4**, todo_write **1**, job_list **1**, grep **1**, ask_user_question **1**, get_goal **1** | événements `tool/call` |
| Appels d'outils en échec remontés | **3** : sandbox write refusé (1), édition sans lecture préalable (1), lecture hors arbre sandbox (1) | `tool/result.isError` |
| Sorties bash non nulles | **12** sur 603 (dont 10 sans marqueur d'erreur = grep/rg sans correspondance) | marqueur `[exit code: N]` |
| **Composition des commandes bash** | **piped 345 (57 %)**, chained 166 (28 %), plain 92 (15 %) | `bashCommandHygiene` |
| Tentatives de compilation | `npx tsc --noEmit` **23**, `npm run check` **5**, `npm install` **4**, `npm ci` **2** | signatures de commandes |
| Cycles de correction (boucle typecheck de portage) | **22 exécutions tsc** en 14 min 31 s (08:30:42 → 08:43:25) | timeline des signatures |
| Temps d'outils cumulé | **111 min 19 s**, dont `bash dsh …` **94 min 32 s** (création de profil, `--dump-config`, serveur de test + attentes d'approbation), `git push` 5 min 16 s, `ask_user_question` 2 min 52 s | deltas `tool/call → tool/result` |
| Temps humain / attente > 60 s | **10 intervalles**, **233 min 56 s** cumulés (dont la pause 123 min) | analyse de gaps |
| **Interventions humaines** | **3 messages utilisateur** pendant la mission (pause, reprise, autorisation d'appel modèle) + **11 demandes d'approbation** (écritures `~/.dsh`, push, PR) + 1 `ask_user_question` | `user/message`, `approval/asked` |
| Relectures répétées de fichiers | **27 relectures** ; top : `team-interaction-bridge.ts` 5, `conversation-projector.ts` 5, `package.json` 4, `team-runtime.ts` 4, `.gitignore` 3, `assistant-builder-runtime.ts` 3, `cordis.patch.yml` 3 | compte `tool/call` par cible |
| Compactions de contexte | **6** (`compaction/start`) | journal |
| Sous-agents | 4 sessions, 212 appels LLM, 325 appels d'outils, 1 005 156 entrée / 130 847 sortie / 15 408 549 cache, spans 19–34 min | agrégat `perSession` |
| **Taille du diff** | 28 fichiers, **+2 444 / −2 595** (lockfile inclus) ; hors lockfile **27 fichiers, +1 056 / −557** | `git diff --shortstat 3dfc9c2..HEAD` |
| Diff par commit | deps +5 206 lignes lockfile · runtime serveur 13 f. +592/−287 · client 8 f. +79/−61 · tests 4 f. +330/−166 · gitignore 1 f. +2 | `git log --shortstat` |
| Fichiers sources les plus touchés | `conversation-projector.ts` +180/−70 · `team-interaction-bridge.ts` +148/−130 · `team-runtime.ts` +69/−30 · `agent-team-service.ts` +53/−21 · 2 nouveaux modules (+81) | `git diff --numstat` |
| Coût d'un sous-agent d'investigation | 38–70 appels LLM, 186k–293k tokens d'entrée, 19–34 min par tranche d'investigation | `perSession` |

### Limites de ces mesures

- Le **côté "coût" n'est pas journalisé** : le harness enregistre les tokens, pas les prix → coût `UNKNOWN`.
- Les échecs **structurellement invisibles** : 85 % des commandes bash étaient pipées ou chaînées,
  donc le code de sortie observé est celui de la dernière commande du pipeline. Les échecs
  de `npm install` (cache en lecture seule) et de `vitest` (5 tests en échec) ont été détectés
  par lecture de sortie, pas par le canal code de sortie. Le nombre de 12 sorties non nulles est
  donc un **majorant des échecs visibles**, pas un décompte d'échecs réels.
- Le temps « actif modèle » vs « attente outil » est approché : `toolWallTime` = somme des deltas
  appel→résultat (il inclut les attentes d'approbation humaine), les gaps > 60 s isolent l'attente
  humaine. Le temps réseau LLM n'est pas instrumenté.

## 3. Chronologie (UTC, 2026-10-20)

| Heure | Événement | Coût |
| --- | --- | --- |
| 05:46:12 | prompt de mission | — |
| 05:49:58 | 1re commande `dsh plugin` (exploration CLI) | |
| 05:54:55 | 1er `npm run check` **baseline 0.1.1** (vert) | ~9 min |
| 05:55 → 06:23 | investigation d'API : 4 sous-agents + diff des `.d.ts` | ~28 min, 212 appels LLM sous-agents |
| 06:23:36 | 1er `npm install` 0.2.0 (puis 3 relances : cache npm sandbox, lockfile) | ~4 min, 4 appels |
| 06:24:32 | 1er `npx tsc` sur 0.2.0 → **liste d'erreurs type = ground truth** (116 erreurs) | 1 appel |
| 06:26:54 | **1re correction dans `src/`** | TTFP 40 min 42 s |
| 06:27:19 | « pause les devs » → arrêt propre (notes à jour) | — |
| 08:30:19 | reprise | pause 123 min |
| 08:30:42 → 08:43:25 | boucle typecheck 22 itérations (pont d'interaction, projecteur, scopes, client) | 13 min |
| 08:43:34 | **1er `npm run check` vert sur 0.2.0** (guard + typecheck + 114 tests + build) | |
| 08:46:50 | `npm run check` re-vérifié | |
| 10:18:15 | création + démarrage du profil de test (écritures `~/.dsh`, 11 approbations) | 94 min de `bash:dsh` cumulé (durée serveur inclus) |
| 10:19 → 10:30 | sondes API réelles : catalog, skills, assistants, équipe 2 membres, message `delivered`, arrêt membre | |
| 10:22 (approx.) | redémarrage serveur → **reprise de session** prouvée sur logs persistés | |
| 10:31–10:39 | tour réel contre stub OpenAI local : streaming live 5→49 caractères, `contextUsage` 137/1/40 | |
| 10:32:19 → 10:40:37 | `npm ci` + `npm run check`, 5 commits, push, PR #12 | |

Les 2 h 20 entre 08:46 et 10:18 correspondent à la vérification d'intégration : c'est la
partie la plus longue de la mission, et la moins outillée (voir §4.11).

## 4. Autocritique — difficultés réelles, avec diagnostic et coût

Format : problème → pourquoi non anticipé → diagnostic → coût → information manquante →
prévention → portée.

### 4.1 `apiProxy` / `MuxFrame` supprimés (pont d'interaction)
- **Problème** : tout le pont d'approbation/questions reposait sur un paquet disparu.
- **Non anticipé** : le prompt listait « vérifier les API réellement présentes » sans exiger
  une liste d'écarts-machine avant toute modification.
- **Diagnostic** : recherche des sites d'augmentation cordis (`declare module '@deepseek-ai/cordis'`)
  dans l'arbre 0.2.0 → waterfalls `approval/request` et `user-questions/request`.
- **Coût** : une tranche d'investigation sous-agent (38–70 appels LLM par sous-agent) + 1 fichier réécrit (+148/−130).
- **Information qui aurait suffi** : la liste des événements cordis enregistrés par les paquets installés
  (`grep -rn "ctx.plugin.*\.on(\|\.on('" node_modules/@deepseek-ai/*/lib/index.js`) — déterministe, ~10 minutes.
- **Prévention** : sonde de surface d'API (voir §6.2) + inventaire des événements.
- **Portée** **DSH-spécifique** (le mécanisme « lister les symboles importés puis tester leur présence » est général).

### 4.2 Version gate 0.2.0 sur les peerDependencies
- **Problème** : le refus de chargement est déclenché par `semver.satisfies(runtimeVersion, peer)`
  sur **chaque** peer `@deepseek-ai/dsh*` avec `includePrerelease`.
- **Non anticipé** : la règle (tous les peers `dsh-*`, pas seulement le paquet racine) n'était pas dans le prompt.
- **Diagnostic** : lecture de `dsh-app-boot/lib/index.js` (`evaluatePluginCompatibility`).
- **Coût** : 1 lecture ciblée ; **aucun** cycle d'échec (la migration des peers a été faite avant le premier boot).
- **Information qui aurait suffi** : le nom de la fonction de gate, dans le brief.
- **Prévention** : la commande `dsh <profil> --dump-config` comme test de gate (rapide, sans serveur).
- **Portée** DSH.

### 4.3 Cache npm en lecture seule sous sandbox
- **Problème** : `npm install` échoue (cache global non inscriptible) ; 4 invocations, 2 lockfiles.
- **Non anticipé** : le sandbox `workspace-write` n'était pas décrit dans le brief.
- **Diagnostic** : lecture de la sortie npm (le **pipeline `| tail` masquait le code de sortie** → échec
  découvert en retard).
- **Coût** : 4 `npm install` + 2 `npm ci`, ~10 min, 1 lockfile régénéré deux fois.
- **Information qui aurait suffi** : « le cache npm global est en lecture seule, utilise
  `--cache <workspace>/.scratch/npm-cache` » + « ne jamais pipeer une commande de gate ».
- **Prévention** : préflight (script de collecte d'environnement) + règle d'hygiène bash.
- **Portée** **générale** (tout développement sandboxé).

### 4.4 Forme des arguments CLI DSH
- **Problème** : `dsh web --profile X` → `option '--profile <name>' argument 'X' is invalid. select a profile only once`.
- **Diagnostic** : `--help` + reformulation positionnelle `dsh <profil> …`.
- **Coût** : 1 cycle (~2 min).
- **Prévention** : mettre la forme exacte dans le guide (fait, §Guide).
- **Portée** DSH.

### 4.5 Élévations de permissions (`~/.dsh`)
- **Problème** : 11 approbations pour créer le profil, ajouter le plugin, `--dump-config`, démarrer le serveur.
- **Non anticipé** : le brief disait « profil de test distinct » sans dire que **tout** écrit sous `~/.dsh`
  sort du périmètre sandbox.
- **Coût** : 94 min 32 s de temps d'outil attribué aux commandes `dsh` (démarrage du serveur + attentes
  d'approbation comprises) ; 11 interruptions humaines.
- **Prévention** : déclarer explicitement dans le brief les chemins à pré-approuver
  (`~/.dsh/profiles/<test>`, `~/.dsh/sessions`) → une seule approbation de périmètre.
- **Portée** générale (planification du périmètre d'écriture).

### 4.6 Tests verts malgré une incompatibilité runtime (le point le plus coûteux)
- **Problème** : 5 tests de service échouaient en cascade (`deliveryState: 'queued'`, `followup` jamais appelé)
  **après** la migration, et un `TypeError` runtime (`assistant-builder-runtime.ts:406`) en test d'intégration.
  Cause : les faux objets de test implémentaient les formes 0.1.x (`session.events`, `setup(ctx)` à 1 argument)
  au lieu des formes 0.2.0 (`snapshotEvents()`, `setup(agentCtx, agent)`).
- **Non anticipé** : la consigne « adapter les tests » était générique ; rien n'imposait que les **doubles
  d'exécution** soient conformes aux signatures réelles.
- **Diagnostic** : lecture de la pile (`agent.session.header.cwd` undefined) puis comparaison avec le `.d.ts` installé.
- **Coût** : 4 fichiers de tests réécrits (+330/−166) ; 2 cycles de diagnostic non linéaires.
- **Information qui aurait suffi** : imposer dans le guide « les mocks reproduisent les signatures du `.d.ts`
  installé, jamais la mémoire de l'ancienne version ».
- **Portée** **générale** (toute migration d'interface avec doubles de test).

### 4.7 Streaming sans preuve d'exécution
- **Problème** : `assistant/chunk` supprimé → nouveau mécanisme (frames cordis + enregistrement durable
  `stream`), **invérifiable par typecheck seul**.
- **Non anticipé** : aucune contrainte « preuve d'exécution » dans le brief ; le build vert a d'abord été pris
  comme signal suffisant.
- **Diagnostic** : lecture des types de frame, puis **stub OpenAI local** (`cordis.patch.yml` + route `probe-openai`,
  clé factice) → observation des nœuds live 5 → 49 caractères et du `dt` persisté ≈ 250 ms/chunk.
- **Coût** : ~25 min de sonde (stub + 3 scripts de sonde) ; 1 tour de modèle gaspillé faute de clé
  (le fournisseur configuré n'avait pas de clé).
- **Information qui aurait suffi** : « aucun fournisseur LLM utilisable dans cet environnement » dans le préflight.
- **Prévention** : le profil de test + stub sont réutilisables tels quels (voir le Guide, §Vérification finale).
- **Portée** DSH + générale (nécessité d'un moyen déterministe de valider le streaming).

### 4.8 Contrats HTTP du plugin lus de mémoire
- **Problème** : la sonde lisait `workbench.members` alors que le type est `workbench.conversations` ;
  les méthodes preneuses d'identifiant attendent `{ id }` et non `{ teamId }`.
- **Non anticipé** : confiance en la mémoire de session (contexte compacté).
- **Diagnostic** : 1 `TypeError: Cannot read properties of undefined (reading 'map')` puis lecture de
  `src/transport/contracts.ts:219`.
- **Coût** : 2 cycles de sonde, ~6 min.
- **Prévention** : règle « relire le contrat avant d'écrire un client » ; le fichier est court.
- **Portée** générale (relire la source plutôt que se fier au résumé de contexte).

### 4.9 Docs de référence internes invalides
- **Problème** : `.scratch/reference/*` cite `docs/specifications/*`, `contracts/*`, `agents/*` : ces chemins
  n'existent pas dans ce dépôt → les contrats de handoff étaient inutilisables.
- **Coût** : 2 lectures complètes d'un fichier de 33 000 tokens (SEQUENTIAL-DELIVERY.md).
- **Prévention** : vérifier l'existence des chemins cités **avant** d'appliquer un processus, et le signaler.
- **Portée** générale.

### 4.10 `PRESET_PROMPT_INCOMPATIBLE` avec le preset `minimal`
- **Problème** : `team.start` refusé (« Preset 'minimal' replaced Agent Team prompt sections ») → 1 cycle.
- **Coût** : ~2 min. **Prévention** : liste des presets compatibles dans le guide.
- **Portée** DSH + produit.

### 4.11 Absence d'outillage d'intégration : 2 h 20 pour la vérification runtime
- **Problème** : la vérification runtime (profil, plugin link, boot, sondes, streaming) a été faite
  **à la main**, commande par commande, avec 11 approbations.
- **Coût** : phase la plus longue de la mission ; `bash:dsh` = 94 min 32 s de temps d'outil.
- **Prévention** : un script de profil de test idempotent (profil + `link:` + serveur + sonde santé),
  et la sonde de surface d'API pour réduire la phase d'investigation.
- **Portée** DSH.

### 4.12 Pression de contexte : 6 compactions, 45 M tokens de cache lu
- **Problème** : une mission de 5 h dans une seule session ; 45 000 000 tokens de lecture cache,
  6 compactions, 27 relectures de fichiers (dont 2 fichiers 5 fois).
- **Coût** : pertes de détail compensées par des relectures ; dépendance au fichier de notes.
- **Prévention** : déléguer l'investigation à des sous-agents avec **sortie structurée courte**
  (186k–293k tokens d'entrée par sous-agent) et produire un artefact machine
  (liste des écarts en JSON) plutôt que du texte.
- **Portage** général.

## 5. Travail effectué qui n'a pas servi

| Travail | Preuve d'inutilité |
| --- | --- |
| Lecture intégrale de `.scratch/reference/SEQUENTIAL-DELIVERY.md` (33k tokens) puis adaptation « SOLO » | documents de handoff inexistants dans le dépôt |
| Vérification d'`archiveSession` / du paramètre `stopActivity` | aucun usage dans le code impacté ; noté « à surveiller », jamais activé |
| Investigation sur `CallId` → `ToolCallId` | type jamais importé par le plugin (surface d'import ne le contient pas) |
| 3e relance d'`npm install` après un `npm install` pipé | l'échec était le cache, pas le lockfile |
| Réécriture du script de sonde (champs `workbench`) | 1 relecture du contrat aurait suffi |
| Recherche de la route modèle réelle (`deepseek-official`) puis échec « no API key » | l'absence de clé était vérifiable en préflight |

## 6. Ce qui était évitable vs inévitable

**Évitable (coût de prévention faible)** : 4.3 (cache + pipe), 4.4 (forme CLI), 4.5 (périmètre
d'approbation), 4.9 (chemins de docs), 4.10 (presets), 5 (routes/chemins invérifiables),
4.8 (relecture de contrat), 4.6 (doubles de test fidèles — règle de rédaction).

**Inévitable dans les contraintes de l'environnement** : 4.1 (le pont n'avait pas d'équivalent :
réécriture nécessaire), 4.2 (la sémantique du gate ne se déduit que du code du runtime),
4.7 (le streaming 0.2.0 n'est observable qu'à l'exécution), 4.11 en partie (aucun outillage
d'intégration n'existait), 4.12 en partie (mission de 5 h sans sous-division en sessions),
les 11 approbations (écritures hors workspace sous `workspace-write`).

## 7. Cinq optimisations classées (gain / coût / risque / mesure)

1. **Sonde de surface d'API (contract probe)** — [tooling/dsh-api-surface.mjs](tooling/dsh-api-surface.mjs).
   *Mécanisme* : extraire les symboles importés par le plugin + les services injectés,
   tester présence et hash de déclaration dans l'arbre installé.
   *Gain* : la liste complète des écarts en 1 appel d'outil (66 symboles, 14 services) contre
   212 appels LLM de 4 sous-agents pour la phase d'investigation. Gain **démontré** sur la
   sonde 0.2.0 → 0.2.1-rc.2 (0 écart détecté, §UPGRADE-WATCH) ; le gain sur la phase
   d'investigation 0.1 → 0.2 est **estimé** (la sonde a été écrite après coup).
   *Coût* : ~150 lignes, aucune dépendance. *Risque* : faux négatifs sur les changements
   sémantiques (elle ne voit pas les comportements).
   *Mesure* : nb d'appels outils de la phase « investigation » (cible < 40 contre 325).
2. **Preflight d'environnement (script)** — version DSH, versions de paquets, peers, Node/npm,
   accessibilité du cache npm, périmètre d'écriture sandbox, présence d'une clé de fournisseur.
   *Gain* : supprime 4 classes d'échec observées (4.3, 4.5, 4.7-dernier, 4.10).
   *Coût* : ~60 lignes + 5 min de lecture de sortie. *Risque* : liste de contrôles à maintenir.
   *Mesure* : nb d'échecs d'environnement en cours de mission (0 visé).
3. **Règle d'hygiène des commandes de gate** — pas de pipeline sur une commande de gate,
   `set -o pipefail`, `--cache <workspace>/.scratch/npm-cache`, un seul gate par appel.
   *Gain* : échecs détectés au premier appel (345 commandes pipées = 57 % des commandes bash).
   *Coût* : zéro (convention). *Risque* : sorties plus longues à lire.
   *Mesure* : ratio `piped` du collecteur (cible < 20 %) et nb de sorties non nulles ignorées.
4. **Doubles de test conformes aux signatures installées** — imposer que chaque mock reproduise
   le `.d.ts` (liste nommée dans la section Tests du guide).
   *Gain* : supprime 4.6 (2 cycles de diagnostic, 496 lignes de tests réécrits en cascade).
   *Coût* : zéro (règle de rédaction). *Risque* : mocks plus verbeux.
   *Mesure* : nb d'échecs de tests causés par un mock obsolète (0 visé).
5. **Profil de test + stub de modèle idempotents** — script de création de profil, `link:`,
   `--dump-config` (gate), serveur, puis sondes d'équipe/message/reprise/streaming.
   *Gain* : réduit la phase d'intégration (2 h 20 observées) et la rend répétable sans clé ni secret.
   *Coût* : ~120 lignes + maintenance des chemins de profil. *Risque* : dépend des versions CLI DSH.
   *Mesure* : temps de la phase d'intégration (cible < 45 min) et nb d'approbations (cible < 4).

## 8. Non mesurable avec les données disponibles

- Coût API en devise (aucun tarif journalisé) → `UNKNOWN`.
- Répartition exacte « temps de réflexion modèle » vs « attente réseau » : le journal horodate les
  événements de message, pas les requêtes HTTP ; le delta step→step l'encadre grossièrement.
- Nombre réel d'échecs de tests : masqué par la composition des commandes (§2, limites).
- Durée des 4 sous-agents en parallèle : leurs spans se recouvrent, la somme (19–34 min chacun)
  n'est pas additive avec le temps mural.
