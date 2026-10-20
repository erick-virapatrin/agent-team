# Brief de mission de migration DSH (réutilisable, autonome)

Version optimisée du brief AGTEAM-COMPAT-001 : **~130 lignes contre ~470 pour l'original**, avec
les faits qui ont coûté des cycles intégrés (préflight, formes CLI, périmètres d'approbation,
mocks conformes, preuve d'exécution). Marque **[U]** = universel, **[0.2]** = propre à 0.1→0.2.

Utilisation : copier le bloc ci-dessous, remplir les 6 champs d'entrée. Ne pas ajouter de contexte
non demandé : chaque paragraphe supplémentaire du brief original a coûté des relectures.

```text
MISSION : migrer le plugin Agent Team de DSH {{VERSION_SOURCE}} vers DSH {{VERSION_CIBLE}}.
Dépôt : {{DEPOT}} (upstream {{REMOTE_UPSTREAM}}, fork push {{REMOTE_FORK}}).
Interdictions : ne PAS toucher au code du harness ; ne PAS bump de version du plugin ;
ne PAS refactorer ; ne PAS fusionner (le PO décide) ; open PR only.
Livrable : branche {{BRANCHE}} + PR, base {{BASE_SHA}} (SHA vérifié, pas "main").
Langue des réponses : {{LANGUE}}. Identifiants, commandes et API en anglais exact.

FAITS D'ENVIRONNEMENT (ne pas les redécouvrir)
- Runtime DSH installé : {{CHEMIN_RUNTIME_DSH}} ; version : {{VERSION_CIBLE}}.
- Politique de fichiers du sandbox : workspace-write. Écrire dans ~/.dsh demande une approbation :
  regroupe TOUTES les écritures de profil dans une seule commande, et demande une seule
  approbation de périmètre pour ~/.dsh/profiles/{{PROFIL_TEST}}.
- Cache npm global en lecture seule : ALWAYS `npm --cache .scratch/npm-cache …`.
- Aucun fournisseur LLM utilisable : la preuve de streaming passe par le stub local (§7).
- Forme CLI : le nom de profil est POSITIONNEL (`dsh <profil> --dump-config`), seul `dsh plugin`
  prend `--profile`. `dsh web --profile X` est invalide.

ORDRE OBLIGATOIRE (ne pas réordonner)
1. Préflight [U] : `node -v`, version du runtime, `npm --cache .scratch/npm-cache ci`,
   `npm run check` (baseline verte sur la version courante). Un gate rouge ici = problème
   d'environnement : réparer avant de migrer. Ne jamais pipeer une commande de gate.
2. Analyse d'écarts [U] : `node docs/engineering/tooling/dsh-api-surface.mjs --imports … --base …
   --target …` → la liste de travail (symboles manquants, signatures modifiées, services disparus).
   Puis `npx tsc --noEmit > .scratch/tc.txt 2>&1; grep -c "error TS" .scratch/tc.txt` après avoir
   aligné package.json (peers) : le recensement d'erreurs EST le plan de port.
3. peers [0.2] : TOUS les `@deepseek-ai/dsh*` + `cordis` alignés sur le runtime. Le gate du
   chargeur évalue `semver.satisfies(runtime, peer, {includePrerelease:true})` sur CHAQUE peer
   (`dsh-app-boot/lib/index.js`). Preuve : `dsh {{PROFIL_TEST}} --dump-config` liste `- id: agent-team`.
4. Port par couches [U] : domain → runtime → service/transport → client → tests. Un fichier à la
   fois, `npx tsc --noEmit` après chaque fichier. Renommage de masse (icônes) : script de
   substitution + vérification du diff, pas d'éditions unitaires.
5. Règle de mocks [0.2] : chaque double de test reproduit la signature du `.d.ts` installé
   (`snapshotEvents()`, `setup(agentCtx, agent)`, `open/read/close`, `handle.header`). Typer les
   doubles avec l'interface réelle pour que le typecheck refuse un mock incomplet.
6. Gate final [U] : `npm run check` (garde d'architecture + typecheck + tests + build), puis `npm ci`
   propre et re-`npm run check`.
7. Preuve d'exécution [U] — NON COUVERTE par le build, obligatoire :
   a. profil de test `--from-default-profile web` (sans bundle expérimental concurrent),
   b. `dsh plugin --profile {{PROFIL_TEST}} add link:{{ABS_PATH}}` + `--dump-config` (gate de charge),
   c. boot `dsh {{PROFIL_TEST}} --no-open --port {{PORT}}`, enregistrement du client dans le log,
   d. sondes API : corps `{requestId, method, payload}`, identifiants sous `{ id }` ; lire
      `src/transport/contracts.ts` avant d'écrire une sonde (ex. `workbench.conversations`),
   e. équipe 2 membres + message + `lastActiveAt` ; arrêt en cours de tour ; messages inter-agents,
   f. redémarrage du serveur → projection des sessions PERSISTÉES (reprise à froid),
   g. streaming via stub OpenAI local : nœud live croissant puis nœud durable ; `usage` non nul.
   Utiliser le script d'intégration s'il existe ; sinon l'écrire dans
   `docs/engineering/tooling/` et le réutiliser.
8. Livrable [U] : commits conventionnels découpés (deps / runtime / client / tests), PR vers
   {{REMOTE_UPSTREAM}} : base, head SHA, ce qui a migré (avant → après), ce qui est prouvé à
   l'exécution, limites connues.

RÉDUCTION DES APPELS D'OUTILS (cible : < 250 appels d'outils, < 40 pour l'investigation)
- Une seule investigation d'API, en parallèle, sortie STRUCTURÉE COURTE (liste de paires
  avant → après). Pas de rédaction de design doc.
- Ne pas relire un fichier déjà lu : relire un contrat avant d'écrire un client, une fois.
- Ne pas explorer le CLI : `--help` une fois, puis utiliser les formes de ce brief.
- Bash : pas de pipeline sur un gate, `&&` max 2 segments, une commande de gate par appel.
- Artefacts intermédiaires dans `.scratch/` (sorties tsc, dumps de config, réponses de sondes) :
  ils évitent de relire les sources et de rejouer les commandes.
- Notes de travail continues dans `.dsh-notes.md` (SHA, décisions, faits vérifiés, reste) :
  c'est la défense contre la compaction, pas un livrable.

CONDITIONS D'ARRÊT (arrêter, écrire, demander)
- Baseline `npm run check` rouge sur la version source → arrêter, signaler.
- Un symbole requis absent du runtime cible sans équivalent identifiable → arrêter la couche,
  documenter l'impasse, proposer 2 options au PO.
- Écriture hors workspace et hors ~/.dsh/profiles/{{PROFIL_TEST}} → ne pas escalader, demander.
- Besoin d'un modèle réel (tour complet, coût) → demander l'autorisation avant, pas après.
- Écart de plus de 2 jours de travail estimé entre le plan et l'avancement → rendre un état
  partiel avec jalons, ne pas poursuivre en silence.

CRITÈRES D'ACCEPTATION (tous prouvés par une sortie citée dans le rapport)
- `npm run check` vert, `npm ci` vert depuis un arbre propre, SHA de la branche et de la base cités.
- Table avant → après de chaque API migrée, avec la source (chemin du `.d.ts` ou fichier du runtime).
- Preuves d'exécution : chargement du plugin, boot, création + démarrage d'équipe, message `delivered`,
  reprise à froid, messages inter-agents, streaming (live + durable), permissions du preset.
- Rollback décrit (commandes) et profil de test isolé du profil de production.
- Aucune hypothèse présentée comme une preuve : marquer VERIFIÉ / INFÉRÉ / INCONNU.

RAPPORT FINAL (format imposé, sans prose supplémentaire)
1. SHA base / head, nombre de commits, taille du diff (avec et sans lockfile).
2. Table API migrée (avant → après → source → preuve).
3. Preuves d'exécution (commande → observation).
4. Limites, comportements volontairement non migrés (`@deprecated` acceptés), risques résiduels.
5. Ce qui a coûté du temps et la prévention (3 lignes).
```

## Ce qui est universel vs propre à 0.1 → 0.2

| Section du brief | Portée |
| --- | --- |
| Préflight, hygiène des gates, périmètres d'approbation, artefacts `.scratch/`, notes anti-compaction, conditions d'arrêt, format de rapport | **[U] universel** |
| Gate de compatibilité sémantique multi-peers, `snapshotEvents`, `setup(agentCtx, agent)`, `acquireScope`, pont cordis, `assistant/chunk`, icônes, `directoryPicker` | **[0.2]** à réécrire pour chaque cible |

## Ce qui a été retiré du brief original (et pourquoi)

| Retiré | Motif mesuré |
| --- | --- |
| Description du produit, de l'architecture, du processus d'archive de session | lu dans le dépôt en 2 lectures ; non utilisé |
| Exigence de documentation d'architecture avant le code | a produit un design doc non relu ; le recensement tsc fait le plan |
| Contexte sur les dépôts de référence et docs de handoff | chemins inexistants dans le dépôt (coût : 33k tokens lus) |
| Listes d'APIs à vérifier « à la main » | remplacées par la sonde de surface (§2) et le recensement tsc |
| Recommandations UI détaillées | 53 renommages d'icônes : la règle « lot scripté + vérification du diff » suffit |
