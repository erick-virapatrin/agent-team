# Veille d'upgrade DSH pour le plugin Agent Team

État mesuré le **2026-10-20**. Le plugin est aligné sur **0.2.0-rc.2** (PR #12, non fusionnée).
Objectif : préparer — sans l'exécuter — la prochaine migration, avec une matrice de risques et des
sondes de contrat réutilisables.

## 1. État du harness (vérifié)

| Référence | Version | Date | Source |
| --- | --- | --- | --- |
| Runtime installé (global) | `0.2.0-rc.2` | 2026-09-29 | `package.json` du paquet global ; registry `time` |
| Cible de la PR #12 | `0.2.0-rc.2` | — | `peerDependencies` de la branche |
| `latest` / `next` npm | **`0.2.1-rc.2`** | 2026-10-17 | `npm view @deepseek-ai/dsh dist-tags` |
| Tags GitHub | `dsh-v0.2.1-rc.2`, `dsh-v0.2.1-rc.1` (17/10), alpha.3 (14/10), alpha.4 (15/10), alpha.5 (16/10) | | `gh release list` |
| Churn 0.2.0-rc.2 → 0.2.1-rc.2 | **1 925 commits**, ≥ 300 fichiers (plafond d'API) | | `gh api …/compare/dsh-v0.2.0-rc.2...dsh-v0.2.1-rc.2` |

## 2. Résultat de la sonde de contrat 0.2.0-rc.2 → 0.2.1-rc.2 (mesuré)

24 paquets utilisés par le plugin récupérés en 0.2.1-rc.2 (`npm pack`) et comparés à l'arbre installé :

```
symboles contrôlés : 66   identiques : 66   manquants : 0   signatures modifiées : 0   services : 14/14 présents
```

Commande reproduite :

```bash
node docs/engineering/tooling/dsh-api-surface.mjs \
  --imports .scratch/plugin-imports.json --services .scratch/plugin-services.json \
  --base node_modules/@deepseek-ai --target .scratch/dsh021/target/@deepseek-ai
```

**Conclusion (VERIFIÉ, avec sa limite)** : la surface d'import + la surface de services du plugin ne
bougent **pas** entre 0.2.0-rc.2 et 0.2.1-rc.2. La sonde compare des déclarations textuelles : elle
ne voit ni les changements de comportement, ni les nouvelles obligations d'exécution, ni les
dépréciations → les lignes P1 ci-dessous restent ouvertes.

Gate de chargement (calculé, `semver` local) : `^0.2.0-rc.2` satisfait `0.2.1-rc.1`, `0.2.1-rc.2`,
`0.2.1` ; **ne satisfait pas** `0.3.0-rc.1` → en 0.3.x le plugin **ne se charge pas** sans bump de peers.
Dépendances d'`@deepseek-ai/dsh@0.2.1-rc.2` : `@deepseek-ai/cordis ~4.0.5` (plugin : `~4.0.5` ✓),
`schemastery ~3.18.5` (plugin : `^3.18.1` ✓).

## 3. Matrice des changements

`Package/API | Version actuelle | Changement identifié | Risque | Test de compatibilité`

### P0 — bloque le chargement ou casse une fonction centrale

| Ligne | Détail |
| --- | --- |
| `@deepseek-ai/dsh*` (peers) | 0.2.0-rc.2 → **0.3.x** | gate de compatibilité sémantique par peer (`includePrerelease`) ; 0.3.x non satisfait par `^0.2.0-rc.2` | **chargement refusé** | `dsh <profil> --dump-config` → présence de `- id: agent-team` |
| `Session.snapshotEvents()`, `Session.ownEvents()`, `Session.eventAt()` | 0.2.1-rc.2 | les trois sont `@deprecated` « new calls are prohibited » (relevé dans `dsh-session/lib/types/index.d.ts` 0.2.1-rc.2) ; la suppression est l'objectif annoncé de la dépréciation | **transcript / reprise à froid / projection** du plugin cassés à la suppression | sonde d'usage : `grep -rn "snapshotEvents\|ownEvents\|eventAt" src/` (3 sites en 0.2.0) + test de reprise à froid (§Guide 6.3) |

### P1 — régression fonctionnelle probable, test requis

| Ligne | Détail |
| --- | --- |
| routing `pi-ai` (système de prompt + outils dynamiques) | rc.1 : « les mises à jour du prompt système en cours de session et l'ajout/retrait dynamique d'outils selon les capacités du modèle » | construction du prompt d'Agent Team (`systemPrompt`) et `PRESET_PROMPT_INCOMPATIBLE` ; outils des membres | tour réel d'un membre d'équipe : prompt stable, outils cohérents |
| presets d'agents / sous-agents | rc.1 : configuration d'un preset par sous-agent | `agentPresets.acquireScope()`, presets de membres, validation de prompt | `team.create` 2 membres + `team.start` → `activeMembers: 2`, `deliveryState: 'delivered'` |
| cycle de vie des plugins (activation/désactivation/mise à jour + rechargement à chaud) | rc.1 : synchronisation des dépendances, application à chaud des plugins remplaçables | `link:` + rechargement sans redémarrage : le plugin assume un redémarrage | modification de code, rechargement, vérification que la nouvelle version est servie |
| API expérimentale d'enregistrement d'état de session pour plugins | rc.1 (nouvelle) | occasion de remplacer l'usage direct de `storageDomain` pour l'état d'équipe | à évaluer ; test = persistance de l'équipe après redémarrage |
| masque des secrets dans les messages envoyés | rc.1 : détection et masque par défaut | contenu des messages relayés entre agents, affichage du transcript | envoyer un jeton factice dans un message d'équipe, vérifier l'affichage |
| outil `working_directory` + SDK de répertoire de travail | rc.1 | isolation par espace de travail (`workspaceRegistry`, ids de workspace) | `team.create` avec workspace, vérification du répertoire effectif |

### P2 — opportunités / faible risque

| Ligne | Détail |
| --- | --- |
| bundle `dsh-experimental-agent-team-profile` | **toujours livré** en 0.2.1-rc.2 | coexistence avec le plugin : le profil de test doit rester sans bundle concurrent |
| outillage développeur expérimental (logs bruts de session, repérage log ↔ chat) | rc.1 | réduit le coût de la phase de diagnostic |
| index de plugins personnalisés, création de plugin depuis l'UI | rc.1 | distribution du plugin hors `link:` |
| `/compact`, presets de raisonnement par modèle dans l'UI, preview YAML des Markdown, répertoire `AGENTS.md` partagé (`DSH_AGENTS_HOME`) | rc.1 | effets de bord sur le contexte des membres ; à observer |

## 4. Sondes de contrat à exécuter avant chaque upgrade

| # | Sonde | Commande | Sortie attendue (base 0.2.1-rc.2 mesurée) |
| --- | --- | --- | --- |
| S1 | Surface d'API | `node docs/engineering/tooling/dsh-api-surface.mjs --imports … --base <arbre courant> --target <arbre cible>` | 0 manquant, 0 signature modifiée, 14/14 services |
| S2 | Usage d'API dépréciées | `grep -rn "snapshotEvents\|ownEvents\|eventAt" src/ tests/` | liste de sites ; **objectif 0** avant une 0.3 |
| S3 | Gate de chargement | `dsh <profil-test> --dump-config \| grep -A4 "id: agent-team"` | entrée présente, sans avertissement de version |
| S4 | Inventory d'événements cordis | `grep -rn "\.on('" <arbre-cible>/@deepseek-ai/*/lib/index.js \| head -60` | `session/event`, `agent/assistant-stream`, `approval/request`, `user-questions/request` présents |
| S5 | Fumée d'exécution | script d'intégration (§Guide 6.6) | équipe créée, message `delivered`, reprise à froid, streaming live + durable |
| S6 | Coût d'upgrade | `gh api …/compare/<tagA>...<tagB> --jq '{commits:.total_commits}'` | signal de volume du delta (1 925 commits pour 0.2.0→0.2.1-rc.2) |

## 5. Plan préparé pour 0.2.0-rc.2 → 0.2.1-rc.2 (non exécuté)

1. **S1 + S4 sur l'arbre cible** (≈ 5 appels d'outils). Résultat déjà mesuré aujourd'hui : aucun écart
   de surface → le port de code est probablement **nul**.
2. **S2** : migrer les 3 sites de lecture synchrone de session vers `session/event` + `open/read`
   **maintenant** (le seam `session/event` existe déjà en 0.2.0-rc.2, vérifié) → supprime le P0
   de la 0.3. Indépendant de toute upgrade.
3. **Bump des peers + `npm ci` + `npm run check`** (≈ 10 appels) : si S1 est propre, le gate doit
   rester vert.
4. **S5** avec le script d'intégration : P1 de la matrice (prompt système, presets de membres,
   rechargement à chaud, masque des secrets, workspace).
5. Rapport : table P0/P1/P2 avec ce qui est devenu vert, ce qui reste ouvert.

Budget attendu, calibré sur les mesures de la mission précédente : investigation **< 40 appels
d'outils** (325 observés avec la méthode manuelle), intégration **< 45 min** (2 h 20 observées),
approbations **< 4** (11 observées).

## 6. À surveiller sans test possible aujourd'hui

- Date de suppression des lectures synchrones d'événements de session (dépréciation sans échéance).
- Stabilité des frames d'assistant (`agent/assistant-stream`) et du format durable `stream`/`usage`.
- Sortie de `0.2.1` stable puis du premier `0.3.x` (bump de peers obligatoire).
- Évolution du bundle expérimental Agent Team livré avec le harness (doublon fonctionnel).
- Comportement du rechargement à chaud sur un plugin `link:` (non testé en 0.2.0-rc.2).
