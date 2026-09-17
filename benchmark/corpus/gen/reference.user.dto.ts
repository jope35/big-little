// Frozen benchmark corpus — generation task REFERENCE file.
// Stays UNDER the 100-line threshold on purpose: the caller reads this
// directly in every run. The saving under test is that the GENERATED file
// stays out of the caller's context (code-writer writes via edit).
// Do not edit after 2026-09-17 without bumping benchmark/corpus/VERSION.
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  tier: "standard" | "silver" | "gold";
  createdAt: string;
}

export function validateUserDto(dto: UserDto): string[] {
  const errors: string[] = [];
  if (!dto.id) errors.push("id is required");
  if (!dto.email || !dto.email.includes("@")) errors.push("email must contain @");
  if (!dto.displayName) errors.push("displayName is required");
  if (dto.createdAt !== "" && Number.isNaN(Date.parse(dto.createdAt))) {
    errors.push("createdAt must be a valid date");
  }
  return errors;
}

export function serializeUserDto(dto: UserDto): string {
  return JSON.stringify(dto);
}

export function deserializeUserDto(raw: string): UserDto {
  const parsed = JSON.parse(raw) as UserDto;
  const errors = validateUserDto(parsed);
  if (errors.length > 0) {
    throw new Error(`invalid UserDto: ${errors.join("; ")}`);
  }
  return parsed;
}

export function summarizeUserDto(dto: UserDto): string {
  return `${dto.id} <${dto.email}> [${dto.tier}]`;
}

export function isPremiumUser(dto: UserDto): boolean {
  return dto.tier === "gold";
}
