-- "Phòng họp" (meeting room map). Room types are checked by the app (MAP_CODES in src/core/maps.ts)
-- from now on, so a new room type needs no migration: drop the old fixed list.
alter table app.rooms drop constraint if exists rooms_map_code_check;
alter table app.rooms add constraint rooms_map_code_check check (map_code ~ '^[a-z_]{2,32}$');
-- On by default (new installs and this one).
alter table app.settings alter column enabled_maps set default '{hall,carpet,tables,drive_in,meeting}';
update app.settings set enabled_maps = array_append(enabled_maps, 'meeting') where not ('meeting' = any(enabled_maps));
