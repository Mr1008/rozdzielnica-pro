-- The parameter rules of the comb busbar kind (roadmap S-12, GitHub #17).
--
-- A comb busbar ("listwa zasilająca") feeds the MCBs of one RCD group from the RCD's output. The
-- catalog records its phases as poles — '1P' is a 1F busbar, '3P' a 3F one — and its rated current;
-- its length in pins is the device width (width_mm / 17.5). It has no N, so `n_terminal_side` stays
-- null, and no protection parameters.
--
-- Restates `devices_parameters_match_kind` like `20261006120000_device_n_terminal_side.sql` did: the
-- earlier branches unchanged, one new branch, and the trailing N-side conjunct. It mirrors
-- `parseDeviceSpec` in `src/lib/device-spec.ts` — change one, change the other.
--
-- Backward-compatible with the deployed code: the old Worker cannot parse a comb_busbar row and drops
-- it from matching; no existing row changes. Re-runnable.

alter table public.devices drop constraint if exists devices_parameters_match_kind;

alter table public.devices add constraint devices_parameters_match_kind check (
  coalesce(
    case kind
      when 'switch_disconnector' then
        poles is not null and poles in ('1P', '2P', '3P', '4P')
        and rated_current_a is not null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is null
      when 'rcd' then
        poles is not null and poles in ('2P', '4P')
        and rated_current_a is not null
        and residual_current_ma is not null
        and rcd_type is not null
        and breaking_capacity_ka is null
        and terminal_groups is null
      when 'rcbo' then
        poles is not null and poles in ('1P+N', '2P', '3P+N', '4P')
        and rated_current_a is not null
        and residual_current_ma is not null
        and rcd_type is not null
        and breaking_capacity_ka is not null
        and terminal_groups is null
      when 'mcb_b' then
        poles is not null and poles in ('1P', '1P+N', '2P', '3P', '3P+N', '4P')
        and rated_current_a is not null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is not null
        and terminal_groups is null
      when 'comb_busbar' then
        poles is not null and poles in ('1P', '3P')
        and rated_current_a is not null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is null
      when 'pe_bar' then
        poles is null
        and rated_current_a is null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is not null
      when 'n_bar' then
        poles is null
        and rated_current_a is null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is not null
      else false
    end,
    false
  )
  and coalesce(
    (n_terminal_side is not null) = (poles is not null and poles in ('1P+N', '2P', '3P+N', '4P')),
    false
  )
);
