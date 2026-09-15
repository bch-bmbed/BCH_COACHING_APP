# Équilibre — dashboard personnel

Dashboard statique sur GitHub Pages, avec journal local et synchronisation privée Supabase. Aucun chiffre de démonstration n'est enregistré. Le SDK Supabase officiel 2.116.0 est conservé localement dans `vendor/` ; aucun chargement de script depuis un CDN.

## Disponible

- Cinq vues : Bilan (calories et repères du jour), Repas, Activités, Suivi (pesées, tendances et historique), Compte (profil, synchronisation, sauvegardes et plateformes). Navigation fixe en bas sur mobile et dans l’en-tête sur PC. La date est commune aux vues du journal. Les quatre repas sont repliables.
- Changer de vue conserve les saisies en cours. Le bouton fixe enregistre la journée ou ajoute une activité selon la vue. Les champs journaliers restent associés au même formulaire ; une valeur invalide ouvre sa vue et son panneau avant d’afficher l’erreur. Les anciens liens `#journal`, `#sync` et `#sources` restent utilisables.
- Métabolisme de base estimé : référence fixe privée dans le profil, synchronisée et sauvegardée, modifiable manuellement lors du suivi nutritionnel. Les pesées ne le recalculent pas. Il représente le repos et ne remplace pas à lui seul la dépense hors séances (qui inclut aussi digestion et mouvements quotidiens). Il n’est jamais additionné à une dépense qui le comprend déjà. [Composantes de la dépense énergétique](https://www.ncbi.nlm.nih.gov/books/NBK591031/).
- Profil du compte : apports habituels prévus, dépense habituelle hors séances, déficit cible facultatif et dernier poids connu. Les objectifs sont réutilisés chaque jour. Leur modification prend effet aujourd’hui ; les périodes précédentes sont conservées.
- Journal daté : repas consommés, séances, dépense totale mesurée par la montre, pesées et note. Une pesée peut être ajoutée depuis le profil ou Suivi. Le dernier poids connu reste affiché dans le profil ; aucune mesure n’est créée les autres jours. Enregistrer uniquement les objectifs ne crée pas de pesée.
- Quatre repas : petit déjeuner, déjeuner, goûter, dîner. Calories et note de recettes/aliments par repas. La somme est automatique ; les repas non renseignés rendent le total provisoire. Saisir 0 pour un repas non pris. Les notes ne sont pas analysées automatiquement pour calculer les calories.
- Activités prévues ou réalisées, durée, calories actives et provenance déclarée. La provenance n'est pas une connexion automatique.
- Calculs immédiats, historique modifiable, graphiques sur 14 jours et moyenne des pesées des 7 derniers jours.
- Sauvegarde locale au clic sur Enregistrer, lors d'un changement de date et des modifications d'activités. Export et import JSON. Les conflits d'import conservent la journée déjà présente.

## Calculs

Déficit prévu = dépense hors séances + calories de toutes les séances (prévues et réalisées) − apports prévus.

Bilan estimé = dépense hors séances + calories des séances réalisées − apports consommés.

Si la dépense totale de la montre est renseignée, elle remplace intégralement la dépense du bilan estimé. Ne pas ajouter le total d'une montre comme une séance. Une valeur manquante reste inconnue ; le zéro doit être saisi explicitement. Les calories des séances doivent être les calories actives additionnelles, hors repos déjà compté dans la base. Un résultat positif est un déficit, un résultat négatif est un surplus. Le déficit cible est informatif, sans prescription ni conversion en kilos.

Les valeurs d'une journée ne modifient pas les journées précédentes. La prévision est recalculée depuis la liste courante des séances : il ne s'agit pas d'un instantané immuable du plan initial. Les graphiques affichent uniquement les journées enregistrées, jusqu'à la date sélectionnée.

## Données et limites

Sans connexion, les données restent dans `localStorage`. Avec le même compte Supabase sur deux appareils, elles sont sauvegardées dans les tables privées `journal_days` (journal) et `account_profiles` (objectifs datés et pesées) et gardées en copie locale propre au compte. Les données ne sont pas chiffrées de bout en bout : HTTPS protège le transport et les règles de base de données limitent l'accès au propriétaire. Les sauvegardes JSON sont personnelles et ne doivent pas être publiées.

Les sauvegardes sont en version 3. Les formats v1 et v2 restent importables : les anciens totaux sont conservés sans inventer leur répartition, et les objectifs/pesées déjà saisis sont repris dans le profil avec leurs dates. Les anciens stockages locaux restent intacts. Chaque compte possède un cache distinct, séparé des données hors connexion. Le bouton « Utiliser le total des quatre repas » remplace explicitement l'ancien total pour une journée. Après connexion, utiliser « Transférer mes données locales vers mon compte » sur chaque appareil possédant des saisies antérieures. Les valeurs différentes d'un même champ sont à départager, les autres champs sont réunis.

La synchronisation intervient après Enregistrer, au retour sur l'onglet, au retour du réseau et toutes les 30 secondes pendant que la page est visible. Une saisie non enregistrée reste à l'écran et suspend la mise à jour. En cas de coupure, la copie locale est conservée. Une fusion à trois versions réunit les repas, activités et champs du profil indépendants ; un conflit sur le même champ exige un choix. La révision serveur est vérifiée de façon atomique pour éviter un écrasement entre lecture et écriture. Les activités sont identifiées individuellement, y compris lors d'une suppression.

Les données illisibles sont protégées contre l'écrasement. L'ouverture simultanée dans plusieurs onglets exige un rechargement si un autre onglet écrit. Les sauvegardes ont une version de schéma ; les futurs connecteurs pourront être adaptés à ce modèle. Les exports natifs Garmin, Google et Urevo ne sont pas acceptés actuellement.

## Publication sur GitHub Pages

Ce dépôt publie les fichiers statiques à la racine via **Settings → Pages → Deploy from a branch → main / root**. Aucun serveur applicatif n'est nécessaire pour cette version. Les changements poussés sur `main` sont republiés par GitHub Pages.

Adresse prévue : https://bch-bmbed.github.io/BCH_COACHING_APP/

Ne jamais publier les sauvegardes personnelles. Le fichier `.gitignore` exclut les sauvegardes `equilibre-*.json`, les dossiers `backups/` et `imports/` ainsi que les fichiers de secrets `.env`.

Documentation : https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## Configuration de la synchronisation PC / téléphone

Projet Supabase : `yuzvnyecrtcvzmxnlhfd`, région Paris (`eu-west-3`). Le fichier `config.js` contient exclusivement l'URL et la clé publique, jamais de clé `service_role` ou secrète.

1. Appliquer dans l’ordre `supabase/migrations/001_journal.sql` puis `supabase/migrations/20260915133026_account_profile.sql` et `supabase/migrations/20260915135813_resting_metabolism.sql`, une seule fois chacune. Les deux tables possèdent RLS, aucun accès anonyme, et des fonctions de sauvegarde vérifiant la révision. La seconde migration reprend les objectifs et pesées des journées existantes sans modifier les repas ni activités. La troisième valide le champ facultatif de métabolisme et le conserve lors des écritures provenant d’un ancien onglet qui ne le connaît pas.
2. Dans **Authentication → URL Configuration**, définir **Site URL** sur `https://bch-bmbed.github.io/BCH_COACHING_APP/` et autoriser exactement cette même URL dans **Redirect URLs**.
3. Authentification par lien e-mail. Le service e-mail par défaut de Supabase n'envoie qu'aux adresses autorisées de l'équipe du projet ; pour ce suivi personnel, utiliser l'adresse du compte Supabase propriétaire. Pour d'autres adresses, configurer un SMTP adapté avant d'ouvrir l'accès. Aucun SMTP payant n'est prévu ici.
4. Ouvrir le dashboard, demander un lien puis l'ouvrir sur le même appareil. Répéter sur le deuxième appareil avec la même adresse. Les comptes de la plateforme Supabase et les utilisateurs de l'application sont distincts : le premier lien crée l'utilisateur du journal.

Le service mail intégré limite actuellement le projet à **2 e-mails par heure**, partagés entre tous les appareils. Si « Limite d’e-mails atteinte » apparaît, attendre environ une heure avant une nouvelle demande. Les sessions déjà connectées et la synchronisation du journal continuent à fonctionner. L’application explique ce blocage en français, sans relancer automatiquement l’envoi. Pour dépasser ce quota, Supabase exige un service SMTP personnalisé ; changer uniquement le réglage de quota ne suffit pas avec le service intégré.

L'offre gratuite était annoncée à 0 $/mois lors de la création. Elle peut être mise en pause après une période d'inactivité ; les copies locales et exports restent disponibles. Voir https://supabase.com/pricing et https://supabase.com/docs/guides/auth/auth-smtp.

## Suite prévue : import automatique des plateformes sportives

Architecture cible : applications et montre → Health Connect sur Android → passerelle Android autorisée par l'utilisateur → API privée et base de données → dashboard GitHub Pages.

Si Garmin et Urevo sont déjà regroupés dans Google Fit, conserver ces connexions. Dans **Google Fit → Profil → Paramètres → Santé Connect**, vérifier l'option **Synchroniser Fit avec Santé Connect**. Vérifier ensuite les données et autorisations dans Santé Connect : voir les activités dans Fit ne garantit pas qu'elles sont toutes redistribuées vers Santé Connect. Contrôler une séance récente de chaque source, sa durée et ses calories, avant de choisir le transfert. Cette version du dashboard ne lit encore ni Google Fit ni Santé Connect.

Guide officiel : https://support.google.com/fit/answer/12830119?hl=fr

Health Connect utilise le SDK Android et stocke les données sur le téléphone. Une page HTML seule ne peut pas le lire. Une passerelle (application Android dédiée ou outil d'export compatible à choisir) reste donc nécessaire, même avec le stockage Supabase déjà préparé.

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

Exécuter `node --test tests/*.test.cjs` : 36 tests de calculs, migration, historique des objectifs, pesées, sauvegardes, fusion, deux clients simulés, conflits de révision et coupure réseau. Les tests de clients utilisent un transport simulé ; ils ne remplacent pas une vérification de connexion e-mail sur les deux appareils.

Navigation vérifiée dans le navigateur aux largeurs 320, 390 et 1280 px : une seule vue visible, aucun débordement horizontal, saisie répartie sur plusieurs onglets puis enregistrement, correction d’un champ invalide dans un panneau masqué, ajout d’activité, rechargement des repas/notes/pesée, retour et avance du navigateur, lien historique de connexion `#sync`. Les données de ces essais restent dans le stockage local de la prévisualisation.

Exécuter `supabase/tests/access-and-revisions.sql` et `supabase/tests/profile-access-and-revisions.sql` sur le projet pour vérifier les accès autorisés/interdits et les révisions. Le script utilise une transaction annulée : aucune donnée fictive ne reste en base. Les deux scripts ont été exécutés avec succès sur le projet. Le contrôle du profil vérifie aussi le rejet d’un document incomplet. L’audit Supabase ne signale pas de problème de table ou de règle d’accès ; il signale la [protection contre les mots de passe compromis désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). L’application utilise actuellement uniquement des liens de connexion par e-mail, et cette évolution ne modifie pas l’authentification.

Profil vérifié dans la prévisualisation : reprise des valeurs existantes, persistance après rechargement, application dès aujourd’hui et aux dates suivantes, conservation des dates précédentes, absence de pesée répétée, formulaires utilisables sur mobile.
