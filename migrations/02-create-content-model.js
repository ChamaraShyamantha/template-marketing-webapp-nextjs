module.exports = function (migration) {
    // ---------------------------------------------------------------------------
    // 1. ComponentSeo
    // ---------------------------------------------------------------------------
    const componentSeo = migration
        .createContentType("componentSeo")
        .name("Component: SEO")
        .displayField("internalName");

    componentSeo.createField("internalName").name("Internal Name").type("Symbol");
    componentSeo.createField("pageTitle").name("Page Title").type("Symbol");
    componentSeo.createField("pageDescription").name("Page Description").type("Text");
    componentSeo.createField("canonicalUrl").name("Canonical URL").type("Symbol");
    componentSeo.createField("nofollow").name("No Follow").type("Boolean");
    componentSeo.createField("noindex").name("No Index").type("Boolean");
    componentSeo.createField("shareImages").name("Share Images").type("Array").items({
        type: "Link",
        linkType: "Asset",
    });

    // ---------------------------------------------------------------------------
    // 2. ComponentAuthor
    // ---------------------------------------------------------------------------
    const componentAuthor = migration
        .createContentType("componentAuthor")
        .name("Component: Author")
        .displayField("name");

    componentAuthor.createField("name").name("Name").type("Symbol").required(true);
    componentAuthor.createField("avatar").name("Avatar").type("Link").linkType("Asset");
    componentAuthor.createField("internalName").name("Internal Name").type("Symbol");

    // ---------------------------------------------------------------------------
    // 3. ComponentRichImage
    // ---------------------------------------------------------------------------
    const componentRichImage = migration
        .createContentType("componentRichImage")
        .name("Component: Rich Image")
        .displayField("internalName");

    componentRichImage.createField("internalName").name("Internal Name").type("Symbol");
    componentRichImage.createField("image").name("Image").type("Link").linkType("Asset");
    componentRichImage.createField("caption").name("Caption").type("Symbol");
    componentRichImage.createField("fullWidth").name("Full Width").type("Boolean");

    // ---------------------------------------------------------------------------
    // 4. PageBlogPost
    // ---------------------------------------------------------------------------
    const pageBlogPost = migration
        .createContentType("pageBlogPost")
        .name("Page: Blog Post")
        .displayField("internalName");

    pageBlogPost.createField("internalName").name("Internal Name").type("Symbol");
    pageBlogPost.createField("slug").name("Slug").type("Symbol").required(true);
    pageBlogPost.createField("title").name("Title").type("Symbol").required(true);
    pageBlogPost.createField("shortDescription").name("Short Description").type("Text");
    pageBlogPost.createField("publishedDate").name("Published Date").type("Date");

    pageBlogPost
        .createField("author")
        .name("Author")
        .type("Link")
        .linkType("Entry")
        .validations([{ linkContentType: ["componentAuthor"] }]);

    pageBlogPost
        .createField("featuredImage")
        .name("Featured Image")
        .type("Link")
        .linkType("Asset");

    pageBlogPost
        .createField("seoFields")
        .name("SEO Fields")
        .type("Link")
        .linkType("Entry")
        .validations([{ linkContentType: ["componentSeo"] }]);

    pageBlogPost
        .createField("content")
        .name("Content")
        .type("RichText")
        .validations([
            {
                enabledNodeTypes: [
                    "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6",
                    "ordered-list", "unordered-list", "hr", "blockquote", "embedded-entry-block", "embedded-asset-block", "hyperlink", "entry-hyperlink", "asset-hyperlink"
                ],
                message: "Only generic node types are allowed"
            },
            {
                enabledMarks: ["bold", "italic", "underline", "code"],
                message: "Only generic marks are allowed"
            }
        ]);

    pageBlogPost
        .createField("relatedBlogPosts")
        .name("Related Blog Posts")
        .type("Array")
        .items({ type: "Link", linkType: "Entry", validations: [{ linkContentType: ["pageBlogPost"] }] });


    // ---------------------------------------------------------------------------
    // 5. PageLanding
    // ---------------------------------------------------------------------------
    const pageLanding = migration
        .createContentType("pageLanding")
        .name("Page: Landing")
        .displayField("internalName");

    pageLanding.createField("internalName").name("Internal Name").type("Symbol");
    pageLanding
        .createField("seoFields")
        .name("SEO Fields")
        .type("Link")
        .linkType("Entry")
        .validations([{ linkContentType: ["componentSeo"] }]);

    pageLanding
        .createField("featuredBlogPost")
        .name("Featured Blog Post")
        .type("Link")
        .linkType("Entry")
        .validations([{ linkContentType: ["pageBlogPost"] }]);

};
