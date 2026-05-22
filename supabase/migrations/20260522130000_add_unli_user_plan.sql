ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_plan_check;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_plan_check
CHECK (plan IN ('free', 'paid', 'unli'));

NOTIFY pgrst, 'reload schema';
