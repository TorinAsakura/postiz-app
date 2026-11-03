# MCP authoring

The existing MCP endpoint and API key remain unchanged.

`POSTIZ_SCHEDULE_POST` accepts `draft`, `scheduled`, and `update`.
Creation accepts either `providerId` or `providerIds` for a single native batch.
Postiz stores one root per selected channel. This does not create a persistent
shared editor object or a Set. Drafts do not require a future date; scheduled
posts do. Supplied image URLs must be public HTTPS URLs and are retained when
`generatePictures` is false.

An update requires `postId` and the text of every existing message. Root and
child IDs, channel, settings, and campaign tags are retained. Omit `images` to
retain attachments; supply an array to replace them. Queued updates require a
future date and use the existing queue replacement mechanism.

`POSTIZ_GET_POST` reads a root and its messages without returning integration
credentials. `POSTIZ_LIST_POSTS` uses the existing calendar year, month, week,
day, and display query. `POSTIZ_DELETE_POST` removes an eligible root group
through the native deletion service without first processing its media.

Mutations reject deleted, child, submitted, and terminal posts and resolve the
root through the authenticated organization before writing.
