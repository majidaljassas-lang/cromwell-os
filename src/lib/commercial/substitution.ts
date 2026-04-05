/**
 * Substitution Logic
 *
 * Products belong to substitution families (e.g. TRACK_FAMILY).
 * Reconciliation operates at:
 *   A. strict product level
 *   B. substitution-family level
 *
 * Rules:
 * - substitution allowed (true/false)
 * - directionality (BIDIRECTIONAL, ONE_WAY)
 * - evidence_required (boolean)
 *
 * If substitution used without evidence → REVIEW_REQUIRED
 */

import { prisma } from "@/lib/prisma";

export interface SubstitutionCheck {
  isSameFamily: boolean;
  familyCode: string | null;
  familyName: string | null;
  substitutionAllowed: boolean;
  evidenceRequired: boolean;
  directionality: string;
}

/**
 * Check if two canonical products belong to the same substitution family.
 */
export async function checkSubstitution(
  productCodeA: string,
  productCodeB: string
): Promise<SubstitutionCheck> {
  if (productCodeA === productCodeB) {
    return {
      isSameFamily: true,
      familyCode: null,
      familyName: null,
      substitutionAllowed: true,
      evidenceRequired: false,
      directionality: "SAME_PRODUCT",
    };
  }

  // Find families that contain product A
  const memberA = await prisma.substitutionFamilyMember.findMany({
    where: { canonicalProduct: { code: productCodeA } },
    include: {
      family: {
        include: {
          members: { include: { canonicalProduct: true } },
        },
      },
    },
  });

  for (const ma of memberA) {
    const hasBInFamily = ma.family.members.some(
      (m) => m.canonicalProduct.code === productCodeB
    );
    if (hasBInFamily) {
      return {
        isSameFamily: true,
        familyCode: ma.family.familyCode,
        familyName: ma.family.name,
        substitutionAllowed: ma.family.substitutionAllowed,
        evidenceRequired: ma.family.evidenceRequired,
        directionality: ma.family.directionality,
      };
    }
  }

  return {
    isSameFamily: false,
    familyCode: null,
    familyName: null,
    substitutionAllowed: false,
    evidenceRequired: false,
    directionality: "NONE",
  };
}

/**
 * Get all family members for a given product code.
 */
export async function getFamilyMembers(
  productCode: string
): Promise<string[]> {
  const memberships = await prisma.substitutionFamilyMember.findMany({
    where: { canonicalProduct: { code: productCode } },
    include: {
      family: {
        include: {
          members: { include: { canonicalProduct: true } },
        },
      },
    },
  });

  const codes = new Set<string>();
  for (const m of memberships) {
    for (const fm of m.family.members) {
      codes.add(fm.canonicalProduct.code);
    }
  }
  return Array.from(codes);
}
