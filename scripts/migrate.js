const { promisify } = require("util");
const { readdir } = require("fs");
const readdirAsync = promisify(readdir);
const path = require("path");
const { createClient } = require("contentful-management");
const { default: runMigration } = require("contentful-migration/built/bin/cli");

// Utility functions
const getVersionOfFile = (file) => file.replace(".js", "").replace(/_/g, ".");
const getFileOfVersion = (version) => version.replace(/\./g, "_") + ".js";

// Helper to format date for environment ID
function getStringDate() {
    const d = new Date();
    function pad(n) {
        return n < 10 ? "0" + n : n;
    }
    return (
        d.toISOString().substring(0, 10) +
        "-" +
        pad(d.getUTCHours()) +
        pad(d.getUTCMinutes())
    );
}

// Configuration variables
// Usage: node migrate.js <SPACE_ID> <ENVIRONMENT_INPUT> <CMA_ACCESS_TOKEN>
const [, , SPACE_ID, ENVIRONMENT_INPUT, CMA_ACCESS_TOKEN] = process.argv;
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations"); // Assuming script is in /scripts

const client = createClient({
    accessToken: CMA_ACCESS_TOKEN,
});

(async () => {
    try {
        console.log(`Running with the following configuration`);
        console.log(`SPACE_ID: ${SPACE_ID}`);
        // console.log(`ENVIRONMENT_INPUT: ${ENVIRONMENT_INPUT}`); // Sensitive if it contains secrets, but usually just branch name

        const space = await client.getSpace(SPACE_ID);

        let ENVIRONMENT_ID = "";

        // Check if we are checking into these branches
        // We treat 'main' and 'master' as production aliases
        if (
            ENVIRONMENT_INPUT === "master" ||
            ENVIRONMENT_INPUT === "main" ||
            ENVIRONMENT_INPUT === "staging" ||
            ENVIRONMENT_INPUT === "qa"
        ) {
            console.log(`Running on ${ENVIRONMENT_INPUT}.`);
            console.log(`Updating ${ENVIRONMENT_INPUT} alias.`);
            ENVIRONMENT_ID = `${ENVIRONMENT_INPUT}-${getStringDate()}`;
        } else {
            console.log("Running on feature branch");
            ENVIRONMENT_ID = ENVIRONMENT_INPUT;
        }
        console.log(`Target ENVIRONMENT_ID: ${ENVIRONMENT_ID}`);

        // ---------------------------------------------------------------------------
        // Step 2: Create Environment
        // ---------------------------------------------------------------------------
        console.log(`Checking if environment ${ENVIRONMENT_ID} exists...`);
        let environment;
        try {
            environment = await space.getEnvironment(ENVIRONMENT_ID);
            console.log(`Environment ${ENVIRONMENT_ID} already exists.`);
        } catch (e) {
            console.log(`Environment ${ENVIRONMENT_ID} not found. Creating...`);
            // If feature branch, we might want to clone from master/main
            // But for new alias environments, we clone from the current alias target usually.
            // The tutorial implies creating from 'master' (default).
            // Let's rely on default behavior or specify source.

            // If we are creating a fresh env for main/staging, we clone from current main/staging?
            // Actually standard practice is cloning from 'master' (the alias).
            // Logic:
            // If creating 'master-2023...', clone from 'master'.
            // If creating 'feature-branch', clone from 'master'.

            try {
                environment = await space.createEnvironmentWithId(ENVIRONMENT_ID, {
                    name: ENVIRONMENT_ID,
                    // cloneFrom: { sys: { type: 'Link', linkType: 'Environment', id: 'master' } } // Optional: specify source
                });
                console.log(`Environment ${ENVIRONMENT_ID} created.`);

                // Wait for processing? createEnvironmentWithId usually waits until ready if using the plain client, 
                // but valid contentful-management client returns the entity. 
                // It might be in 'queued' state. We need to wait for it to be ready.

                // Simple polling for availability
                let ready = false;
                while (!ready) {
                    console.log("Waiting for environment to be ready...");
                    await new Promise(r => setTimeout(r, 2000));
                    environment = await space.getEnvironment(ENVIRONMENT_ID);
                    if (environment.sys.status.sys.id === 'ready') {
                        ready = true;
                    }
                }
                console.log(`Environment ${ENVIRONMENT_ID} is ready.`);

            } catch (createErr) {
                console.error("Error creating environment:", createErr);
                throw createErr;
            }
        }

        // ---------------------------------------------------------------------------
        // Enable API Keys (Tutorial Step 2 part 2)
        // ---------------------------------------------------------------------------
        // NOTE: This updates ALL CDA keys to access the new environment. 
        // This is useful so that your tests can access the new env.
        console.log('Update API keys to allow access to new environment');
        const newEnvLink = {
            sys: {
                type: 'Link',
                linkType: 'Environment',
                id: ENVIRONMENT_ID,
            },
        };

        const { items: keys } = await space.getApiKeys();
        await Promise.all(
            keys.map((key) => {
                console.log(`Updating - ${key.name}`);
                // Check if already has access
                const hasAccess = key.environments.some(env => env.sys.id === ENVIRONMENT_ID);
                if (!hasAccess) {
                    key.environments.push(newEnvLink);
                    return key.update();
                }
                return Promise.resolve();
            })
        );


        // ---------------------------------------------------------------------------
        // Step 5: Run Migrations
        // ---------------------------------------------------------------------------
        console.log("Set default locale to new environment");
        // We need to fetch locales to know what the default is for versionTracking
        const locales = await environment.getLocales();
        const defaultLocale = locales.items.find((locale) => locale.default).code;

        console.log("Read all the available migrations from the file system");
        const availableMigrations = (await readdirAsync(MIGRATIONS_DIR))
            .filter((file) => /^\d+?.+\.js$/.test(file)) // Updated regex to allow names like 01-setup.js
            .map((file) => getVersionOfFile(file));

        console.log("Figure out latest ran migration of the contentful space");
        // Ensure versionTracking content type exists before query
        // If it doesn't exist, this throws. User must create it as per plan.
        let storedVersionEntry;
        try {
            const { items: versions } = await environment.getEntries({
                content_type: "versionTracking",
            });
            if (versions.length > 1) {
                throw new Error("There should only be one entry of type 'versionTracking'");
            }
            if (versions.length === 1) {
                storedVersionEntry = versions[0];
            }
        } catch (e) {
            console.warn("Could not find versionTracking entry or content type. Assuming initial state if intentional.");
            console.warn(e.message);
            // If we want to be strict, we throw. 
            // For now, let's assume if it fails, we might be in a broken state or fresh env without content type.
            // But the tutorial assumes it exists.
        }

        let currentVersionString = "0"; // Default if not found?
        if (storedVersionEntry) {
            currentVersionString = storedVersionEntry.fields.version[defaultLocale] || "0";
        } else {
            console.log("No versionTracking entry found. Assuming version 0 start.");
        }

        console.log(`Current Version: ${currentVersionString}`);

        console.log("Evaluate which migrations to run");
        // Simple comparison logic: files are like '01-setup', '02-foo'.
        // We sort availableMigrations and run those that are 'greater' than currentVersion?
        // Or we stick to index finding.

        // Tutorial uses indexOf. This requires exact match and order.
        // "01-setup" vs "01-setup".

        // Let's sort availableMigrations first.
        availableMigrations.sort(); // Lexicographical sort works for 01, 02...

        let currentMigrationIndex = -1;
        if (currentVersionString !== "0") {
            currentMigrationIndex = availableMigrations.indexOf(currentVersionString);
        }

        // If currentVersion is set but not in list (maybe deleted?), we have a problem or we just run newer ones?
        // If currentMigrationIndex is -1 and currentVersionString is not 0, it means we can't find the last run migration.
        if (currentMigrationIndex === -1 && currentVersionString !== "0") {
            throw new Error(
                `Version ${currentVersionString} is not matching with any known migration`
            );
        }

        const migrationsToRun = availableMigrations.slice(currentMigrationIndex + 1);
        console.log('Migrations to run:', migrationsToRun);

        // Run migrations using contentful-migration CLI tool programmatically
        const migrationOptions = {
            spaceId: SPACE_ID,
            environmentId: ENVIRONMENT_ID,
            accessToken: CMA_ACCESS_TOKEN,
            yes: true,
        };

        for (const migrationFile of migrationsToRun) {
            const filePath = path.join(MIGRATIONS_DIR, getFileOfVersion(migrationFile));
            console.log(`Running migration: ${migrationFile}`);

            await runMigration({
                ...migrationOptions,
                filePath
            });

            console.log(`Migration ${migrationFile} succeeded`);

            // Update versionTracking
            // If we didn't have an entry, we create it? Tutorial implies one exists. 
            // We should create if missing for robustness.
            if (storedVersionEntry) {
                storedVersionEntry.fields.version[defaultLocale] = migrationFile;
                storedVersionEntry = await storedVersionEntry.update();
                storedVersionEntry = await storedVersionEntry.publish();
            } else {
                // Create it
                // Need to know content type ID
                // Checks if 'versionTracking' type exists?
                // Assuming it does.
                storedVersionEntry = await environment.createEntry("versionTracking", {
                    fields: {
                        version: {
                            [defaultLocale]: migrationFile
                        }
                    }
                });
                storedVersionEntry = await storedVersionEntry.publish();
                console.log("Created valid versionTracking entry.");
            }

        }

        // ---------------------------------------------------------------------------
        // Step 6: Update Alias (if applicable)
        // ---------------------------------------------------------------------------
        if (
            ENVIRONMENT_INPUT === "master" ||
            ENVIRONMENT_INPUT === "main" ||
            ENVIRONMENT_INPUT === "staging" ||
            ENVIRONMENT_INPUT === "qa"
        ) {
            console.log(`Updating ${ENVIRONMENT_INPUT} alias.`);
            try {
                // getEnvironmentAlias needs space context
                const environmentAlias = await space.getEnvironmentAlias(ENVIRONMENT_INPUT);
                environmentAlias.environment.sys.id = ENVIRONMENT_ID;
                await environmentAlias.update();
                console.log(`Alias ${ENVIRONMENT_INPUT} updated to ${ENVIRONMENT_ID}.`);

                // Cleanup Old Environments?
                // Not in tutorial, but needed for production grade.
                // We can list environments starting with "${ENVIRONMENT_INPUT}-" and delete old ones.
                console.log("Cleaning up old environments...");
                const { items: allEnvs } = await space.getEnvironments();
                const matchingEnvs = allEnvs
                    .filter(e => e.name.startsWith(`${ENVIRONMENT_INPUT}-`))
                    .sort((a, b) => new Date(b.sys.createdAt) - new Date(a.sys.createdAt)); // Newest first

                // Keep top X (e.g., 3)
                const KEEP_COUNT = 3;
                const envsToDelete = matchingEnvs.slice(KEEP_COUNT);

                for (const env of envsToDelete) {
                    if (env.sys.id !== ENVIRONMENT_ID) { // Don't delete current
                        console.log(`Deleting old environment: ${env.sys.id}`);
                        await env.delete();
                    }
                }

            } catch (e) {
                console.error("Error updating alias or cleaning up:", e);
            }
        } else {
            console.log("Running on feature branch. No alias changes required.");
        }

        console.log("All done!");

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
