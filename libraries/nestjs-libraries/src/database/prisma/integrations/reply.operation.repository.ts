import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '../prisma.service';

@Injectable()
export class ReplyOperationRepository {
  constructor(private prisma: PrismaRepository<'socialReplyOperation'>) {}

  async find(organizationId: string, requestId: string) {
    return await this.prisma.model.socialReplyOperation.findUnique({
      where: { organizationId_requestId: { organizationId, requestId } },
    });
  }

  async claim(data: Prisma.SocialReplyOperationCreateInput) {
    try {
      return await this.prisma.model.socialReplyOperation.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  async update(id: string, data: Prisma.SocialReplyOperationUpdateInput) {
    return await this.prisma.model.socialReplyOperation.update({
      where: { id },
      data,
    });
  }
}
