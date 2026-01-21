const { createClient } = require("contentful-management");

const [, , SPACE_ID, ACCESS_TOKEN] = process.argv;

const client = createClient({
    accessToken: ACCESS_TOKEN,
});

(async () => {
    try {
        const space = await client.getSpace(SPACE_ID);
        const environment = await space.getEnvironment('master');
        const contentTypes = await environment.getContentTypes();

        console.log(`\nFound ${contentTypes.items.length} Content Types in 'master':`);
        contentTypes.items.forEach(ct => {
            console.log(` - ${ct.name} (${ct.sys.id}) [Published: ${!!ct.sys.publishedVersion}]`);
        });

        if (contentTypes.items.length === 0) {
            console.log("\nWARNING: Space is empty! You must import the content model.");
        }
    } catch (e) {
        console.error(e);
    }
})();
