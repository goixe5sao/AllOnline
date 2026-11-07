-- Voice chat with the people around you: who may talk (off | all | accounts), chosen by the room owner.
alter table app.rooms add column if not exists voice_mode text not null default 'all' check (voice_mode in ('off', 'all', 'accounts'));
