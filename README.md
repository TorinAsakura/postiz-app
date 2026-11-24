<p align="center">
  <a href="https://affiliate.postiz.com">
    <img src="https://github.com/user-attachments/assets/af9f47b3-e20c-402b-bd11-02f39248d738" />
  </a>
</p>

<p align="center">
  <a href="https://postiz.com/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/765e9d72-3ee7-4a56-9d59-a2c9befe2311">
    <img alt="Postiz Logo" src="https://github.com/user-attachments/assets/f0d30d70-dddb-4142-8876-e9aa6ed1cb99" width="280"/>
  </picture>
  </a>
</p>

<p align="center">
<a href="https://opensource.org/licenses/Apache-2.0">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License">
</a>
</p>

<div align="center">
  <strong>
  <h2>Your ultimate AI social media scheduling tool</h2><br />
  <a href="https://postiz.com">Postiz</a>: An alternative to: Buffer.com, Hypefury, Twitter Hunter, Etc...<br /><br />
  </strong>
  Postiz offers everything you need to manage your social media posts,<br />build an audience, capture leads, and grow your business.
</div>

<div class="flex" align="center">
  <br />
  <img alt="Instagram" src="https://postiz.com/svgs/socials/Instagram.svg" width="32">
  <img alt="Youtube" src="https://postiz.com/svgs/socials/Youtube.svg" width="32">
  <img alt="Dribbble" src="https://postiz.com/svgs/socials/Dribbble.svg" width="32">
  <img alt="Linkedin" src="https://postiz.com/svgs/socials/Linkedin.svg" width="32">
  <img alt="Reddit" src="https://postiz.com/svgs/socials/Reddit.svg" width="32">
  <img alt="TikTok" src="https://postiz.com/svgs/socials/TikTok.svg" width="32">
  <img alt="Facebook" src="https://postiz.com/svgs/socials/Facebook.svg" width="32">
  <img alt="Pinterest" src="https://postiz.com/svgs/socials/Pinterest.svg" width="32">
  <img alt="Threads" src="https://postiz.com/svgs/socials/Threads.svg" width="32">
  <img alt="X" src="https://postiz.com/svgs/socials/X.svg" width="32">
  <img alt="X" src="https://postiz.com/svgs/socials/Slack.svg" width="32">
  <img alt="X" src="https://postiz.com/svgs/socials/Discord.svg" width="32">
  <img alt="X" src="https://postiz.com/svgs/socials/Mastodon.svg" width="32">
  <img alt="X" src="https://postiz.com/svgs/socials/Bluesky.svg" width="32">
</div>

<p align="center">
  <br />
  <a href="https://docs.postiz.com" rel="dofollow"><strong>Explore the docs »</strong></a>
  <br />

  <br />
  <a href="https://youtube.com/@postizofficial" rel="dofollow"><strong>Watch the YouTube Tutorials»</strong></a>
  <br />

  <br/>
    <a href="https://platform.postiz.com">Register</a>
    ·
    <a href="https://discord.postiz.com">Join Our Discord (devs only)</a>
    ·
    <a href="https://twitter.com/getpostiz">X</a>
    ·
    <a href="https://gitroom.com">Gitroom</a>
    ·
    <a href="https://git.sn/telegram">Telegram (Crypto)</a>
  </p>

<br />

<p align="center">
  <video src="https://github.com/user-attachments/assets/05436a01-19c8-4827-b57f-05a5e7637a67" width="100%" />
</p>

## ✨ Features

| ![Image 1](https://github.com/user-attachments/assets/a27ee220-beb7-4c7e-8c1b-2c44301f82ef) | ![Image 2](https://github.com/user-attachments/assets/eb5f5f15-ed90-47fc-811c-03ccba6fa8a2) |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ![Image 3](https://github.com/user-attachments/assets/d51786ee-ddd8-4ef8-8138-5192e9cfe7c3) | ![Image 4](https://github.com/user-attachments/assets/91f83c89-22f6-43d6-b7aa-d2d3378289fb) |

# Intro

- Schedule all your social media posts (many AI features)
- Measure your work with analytics.
- Collaborate with other team members to exchange or buy posts.
- Invite your team members to collaborate, comment, and schedule posts.
- At the moment there is no difference between the hosted version to the self-hosted version

## Tech Stack

- NX (Monorepo)
- NextJS (React)
- NestJS
- Prisma (Default to PostgreSQL)
- Redis (BullMQ)
- Resend (email notifications)

## Quick Start

To have the project up and running, please follow the [Quick Start Guide](https://docs.postiz.com/quickstart)

## Maintenance API: social comments

The maintenance fork exposes incoming social conversations separately from
Postiz's internal collaboration comments. Threads is the first supported
provider. Existing publishing and scheduled thread operations are unchanged.

- `POSTIZ_PROVIDERS_LIST` returns `accountId`, the native account identity
- `POSTIZ_READ_SOCIAL_CONVERSATION` reads the root post and all available reply
  pages, retaining native IDs, parent IDs, author information and timestamps
- `POSTIZ_REPLY_TO_SOCIAL_COMMENT` sends a text reply to an exact native comment
  from an explicitly selected integration and account
- The equivalent authenticated API routes are
  `GET /public/v1/social-comments/conversation` and
  `POST /public/v1/social-comments/reply`

Reading requires `integrationId`, `expectedActorId` and the native `postId`.
Replying also requires `commentId`, `message` and a stable `requestId`.
The account must own the publication, and the comment must be in its conversation.
The Threads connection needs `threads_read_replies`; existing tokens need a
normal reconnection to obtain newly requested permissions.

Reuse the same request ID and exact payload after interruption. A different
payload for that ID is rejected. Claims and native reply IDs are retained in
the existing PostgreSQL database, not an expiring cache. The result distinguishes
`pending`, `unknown`, `published` and `confirmed`. Only `confirmed` means that
the native reply was read back under the exact parent and account. A repeated
operation never sends again. An unknown outcome without a native ID requires
inspection of the conversation, not a fresh request ID to bypass protection.

Permalinks are returned only when provided by the social API; a missing comment
permalink is `null`, not a fabricated URL or a relabelled root-post link.
No polling inbox, automatic social replies or public test messages are enabled.

Run `pnpm test:backend` for the backend/provider regression tests and
`pnpm build:backend` for the production compiler configuration.

## Invest in the Postiz Coin :)

DMsTbeCfX1crgAse5tver98KAMarPWeP3d6U3Gmmpump

# License

This repository's source code is available under the [AGPL-3.0 license](LICENSE).

<br /><br /><br />

<p align="center">
  <a href="https://www.g2.com/products/postiz/take_survey" target="blank"><img alt="g2" src="https://github.com/user-attachments/assets/892cb74c-0b49-4589-b2f5-fbdbf7a98f66" /></a>
</p>
