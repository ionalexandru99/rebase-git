ALTER TABLE `repository_catalog` ADD `color` text DEFAULT 'blue' NOT NULL;--> statement-breakpoint
UPDATE `repository_catalog` SET `color` = `ranked`.`color` FROM (
  SELECT `id`, CASE (dense_rank() OVER (ORDER BY coalesce(`logical_repository_id`, `id`)) - 1) % 8
    WHEN 0 THEN 'blue'
    WHEN 1 THEN 'green'
    WHEN 2 THEN 'violet'
    WHEN 3 THEN 'orange'
    WHEN 4 THEN 'lime'
    WHEN 5 THEN 'cyan'
    WHEN 6 THEN 'red'
    ELSE 'amber'
  END AS `color`
  FROM `repository_catalog`
) AS `ranked`
WHERE `repository_catalog`.`id` = `ranked`.`id`;
