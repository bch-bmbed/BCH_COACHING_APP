# Équilibre — dashboard personnel

Première version statique, sans dépendance ni compte requis, compatible avec GitHub Pages. Ouvrir `index.html` dans un navigateur, ou servir ce dossier avec un serveur HTTP local. Aucun chiffre de démonstration n'est enregistré.

## Disponible

- Journal daté : apports prévus et consommés, dépense hors séances, déficit cible facultatif, total de la montre, poids et note.
- Activités prévues ou réalisées, durée, calories actives et provenance déclarée. La provenance n'est pas une connexion automatique.
- Calculs immédiats, historique modifiable, graphiques sur 14 jours et moyenne des pesées des 7 derniers jours.
- Sauvegarde locale au clic sur Enregistrer, lors d'un changement de date et des modifications d'activités. Export et import JSON. Les conflits d'import conservent la journée déjà présente.

## Calculs

Déficit prévu = dépense hors séances + calories de toutes les séances (prévues et réalisées) − apports prévus.

Bilan estimé = dépense hors séances + calories des séances réalisées − apports consommés.

Si la dépense totale de la montre est renseignée, elle remplace intégralement la dépense du bilan estimé. Ne pas ajouter le total d'une montre comme une séance. Une valeur manquante reste inconnue ; le zéro doit être saisi explicitement. Les calories des séances doivent être les calories actives additionnelles, hors repos déjà compté dans la base. Un résultat positif est un déficit, un résultat négatif est un surplus. Le déficit cible est informatif, sans prescription ni conversion en kilos.

Les valeurs d'une journée ne modifient pas les journées précédentes. La prévision est recalculée depuis la liste courante des séances : il ne s'agit pas d'un instantané immuable du plan initial. Les graphiques affichent uniquement les journées enregistrées, jusqu'à la date sélectionnée.

## Données et limites

Les données restent dans `localStorage`, sur ce navigateur et cette origine web. Un autre téléphone, navigateur, une navigation privée ou une autre URL ne partagent pas la sauvegarde. Le passage du fichier local au site GitHub nécessite un export puis un import. Il n'y a ni authentification, ni stockage serveur, ni chiffrement applicatif. Les sauvegardes JSON contiennent des informations personnelles : ne pas les ajouter au dépôt public.

Les données illisibles sont protégées contre l'écrasement. L'ouverture simultanée dans plusieurs onglets exige un rechargement si un autre onglet écrit. Les sauvegardes ont une version de schéma ; les futurs connecteurs pourront être adaptés à ce modèle. Les exports natifs Garmin, Google et Urevo ne sont pas acceptés actuellement.

## Publication sur GitHub Pages

Ce dépôt publie les fichiers statiques à la racine via **Settings → Pages → Deploy from a branch → main / root**. Aucun serveur applicatif n'est nécessaire pour cette version. Les changements poussés sur `main` sont republiés par GitHub Pages.

Adresse prévue : https://bch-bmbed.github.io/BCH_COACHING_APP/

Ne jamais publier les sauvegardes personnelles. Le fichier `.gitignore` exclut les sauvegardes `equilibre-*.json`, les dossiers `backups/` et `imports/` ainsi que les fichiers de secrets `.env`.

Documentation : https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## Suite prévue : synchronisation Android

Architecture cible : applications et montre → Health Connect sur Android → passerelle Android autorisée par l'utilisateur → API privée et base de données → dashboard GitHub Pages.

Si Garmin et Urevo sont déjà regroupés dans Google Fit, conserver ces connexions. Dans **Google Fit → Profil → Paramètres → Santé Connect**, vérifier l'option **Synchroniser Fit avec Santé Connect**. Vérifier ensuite les données et autorisations dans Santé Connect : voir les activités dans Fit ne garantit pas qu'elles sont toutes redistribuées vers Santé Connect. Contrôler une séance récente de chaque source, sa durée et ses calories, avant de choisir le transfert. Cette version du dashboard ne lit encore ni Google Fit ni Santé Connect.

Guide officiel : https://support.google.com/fit/answer/12830119?hl=fr

Health Connect utilise le SDK Android et stocke les données sur le téléphone. Une page HTML seule ne peut pas le lire. Une passerelle (application Android dédiée ou outil d'export compatible à choisir) reste donc nécessaire, même avec un serveur. Le stockage distant exigera une authentification individuelle, des autorisations par utilisateur et des secrets conservés côté serveur. Le choix de l'hébergement gratuit et de ses quotas reste à vérifier avant déploiement.

- **Google Fit** : le guide actuel annonce un support des API jusqu'à fin 2026. Ne pas démarrer une nouvelle intégration sur cette API. Health Connect convient à l'agrégation Android ; Google Health API concerne les appareils Google/Fitbit et ne remplace pas un agrégateur universel.
- **Garmin Connect** : API directe réservée aux usages professionnels approuvés. Garmin documente le partage vers Health Connect ; vérifier les catégories effectivement partagées et l'historique sur le téléphone.
- **Urevo** : partage annoncé avec Google Fit et Apple Health. Vérifier dans l'application utilisée si Health Connect est disponible directement, ou quel export/pont est disponible. Aucune API publique Urevo adaptée n'a été confirmée.
- **Futur bracelet** : conserver les mêmes journées et ajouter un adaptateur. Les futurs enregistrements synchronisés devront porter un identifiant externe, une source, un horodatage et un fuseau. Dédupliquer les séances par source et identifiant, puis détecter les copies entre plateformes ; définir une seule source prioritaire pour la dépense quotidienne totale.

Sources officielles consultées le 15 septembre 2026 :

- https://developer.android.com/health-and-fitness/health-connect/migration/fit
- https://developer.android.com/health-and-fitness/health-connect/architecture
- https://developers.google.com/health/about
- https://developer.garmin.com/gc-developer-program/program-faq/
- https://support.garmin.com/lv-LV/?faq=JToBEy0jfe6pIygark2Ui5
- https://www.urevo.us/pages/urevo-app

## Vérification

Exécuter `node --test tests/model.test.cjs` pour vérifier les calculs, les dates, les valeurs manquantes, l'absence de double comptage et la fusion des sauvegardes.
