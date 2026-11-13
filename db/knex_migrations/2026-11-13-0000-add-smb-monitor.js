exports.up = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.string("smb_share");
        table.string("smb_path");
        table.string("smb_domain");
        table.string("smb_username");
        table.string("smb_password");
    });
};
exports.down = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        for (const name of ["smb_share", "smb_path", "smb_domain", "smb_username", "smb_password"]) table.dropColumn(name);
    });
};
