# PREFS — préférences de notifications

Le contrat Swagger/OpenAPI est dans le fichier existant
[lms_project.json](../postman/specs/lms_project/lms_project.json), déjà lié à
Postman. Les opérations GET et PUT de `/api/trainer/preferences` et les
composants préfixés `Prefs` y décrivent PREFS. Les autres opérations sont
conservées. Ce fichier peut aussi être importé dans Swagger Editor.
Le projet ne contient pas de serveur Swagger UI ; aucun endpoint `/api-docs`
n'est ajouté par cette fonctionnalité.

## Utilisation depuis React ou Postman

Se connecter avec `POST /api/auth/login`, puis envoyer le JWT retourné dans
`Authorization: Bearer <token>`. Les deux routes exigent un compte actif avec
le rôle `trainer`. Les rôles `learner` et `admin` reçoivent 403.

### GET /api/trainer/preferences

Sans préférences enregistrées, la réponse 200 est :

```json
{
  "enabled": true,
  "courses": [],
  "frequency": "daily"
}
```

Ce GET ne crée aucun document. Si des préférences existent, la réponse reste
un objet direct et contient aussi `_id`, `trainer`, `createdAt`, `updatedAt`
et éventuellement `__v`. Elle n'est pas enveloppée dans `preferences`.

### PUT /api/trainer/preferences

Les trois champs sont obligatoires, même pour se désabonner :

```json
{
  "enabled": false,
  "frequency": "weekly",
  "courses": []
}
```

- `enabled` doit être un booléen, pas une chaîne comme `"false"`.
- `frequency` vaut exactement `daily` ou `weekly`.
- `courses` doit être un tableau d'ObjectId MongoDB de 24 caractères hexadécimaux.
- Tous les cours doivent exister et appartenir au formateur connecté.
- Les doublons sont supprimés, y compris lorsque leur casse diffère.
- Une sélection vide est acceptée. PREFS enregistre ce choix sans définir ici
  son interprétation par les traitements de résumés.
- Le formateur est toujours celui authentifié ; un champ `trainer` envoyé par
  le client ne permet pas de modifier les préférences d'un autre compte.

La création et la modification renvoient toutes les deux 200 :

```json
{
  "message": "Preferences updated successfully",
  "preferences": {
    "_id": "507f1f77bcf86cd799439011",
    "trainer": "507f191e810c19729de860ea",
    "enabled": false,
    "frequency": "weekly",
    "courses": [],
    "createdAt": "2026-10-26T08:00:00.000Z",
    "updatedAt": "2026-10-26T09:00:00.000Z",
    "__v": 0
  }
}
```

Pour React, lire directement le corps JSON du GET et `body.preferences` après
le PUT. Ces formes de réponse existantes sont conservées.

## Erreurs

| Statut | Cas | Corps |
|---|---|---|
| 400 | PUT absent ou invalide, cours inexistant ou non possédé | `{ "message": "..." }` |
| 401 | JWT absent, invalide, expiré ou utilisateur supprimé | `{ "success": false, "message": "..." }` |
| 403 | Compte suspendu ou rôle non autorisé | `{ "success": false, "message": "..." }` |
| 500 | Erreur de lecture/enregistrement des préférences | `{ "message": "Server error" }` |

Les messages et exemples exacts figurent dans le document OpenAPI.
Un PUT rejeté par les validations ne modifie pas les préférences existantes.

## Vérification automatisée

Avec MongoDB accessible à l'adresse configurée pour le projet :

```powershell
npm.cmd test -- --runTestsByPath tests/notificationPreference.test.js
```

La suite utilise Express, Supertest, les vrais middlewares JWT et MongoDB.
Les comptes, cours et préférences sont créés dans une base temporaire
`lms_prefs_test_<ObjectId>`, distincte de la base configurée dans `MONGO_URI`.
Cette base temporaire est supprimée après les tests. Aucun fichier `.env`
n'est modifié. Seuls les deux scénarios d'erreur de stockage simulent une
panne de MongoDB pour vérifier les réponses 500.

Couverture : valeurs par défaut sans persistance, création/mise à jour,
activation/désactivation, daily/weekly, sélection et propriété des cours,
déduplication, types et champs obligatoires, ObjectId invalides, isolation
des formateurs, JWT manquant/invalide/expiré, rôles interdits, compte suspendu,
utilisateur supprimé et erreurs de stockage sans fuite de détails internes.

Validation locale du document OpenAPI avec la CLI Postman :

```powershell
node scripts/validatePrefsOpenapi.js
```

Cette commande extrait uniquement PREFS et ses composants du contrat existant
dans un fichier temporaire, lance `postman spec lint --issueType=syntax
--no-report-events`, puis supprime ce fichier. Elle ne modifie pas le manifeste
du workspace. Il n'y a pas de seconde copie du contrat à maintenir.

La validation de syntaxe/structure ne nécessite pas de connexion Postman et
ne publie pas le document. Les règles de gouvernance du workspace nécessitent
une connexion et ne sont pas couvertes par cette commande.

Le lint du fichier OpenAPI complet signale encore 28 erreurs préexistantes sur
les réponses vides des autres routes. Elles sont hors du périmètre PREFS et
ne sont pas corrigées ici. La validation isolée permet de vérifier PREFS sans
masquer cette dette documentaire globale.

JOBS et EMAIL ne font pas partie de ce périmètre.
